import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, BookOpen, Check, ChevronRight, ExternalLink, Flag, Layers3, Play, Shield, Zap } from "lucide-react";
import { NEW_PLAYER_BASICS, NEW_PLAYER_DOMAINS, NEW_PLAYER_DOMAIN_SOURCE, NEW_PLAYER_RULE_SOURCES, nextUnreadBasicsTopic, type NewPlayerTopic } from "../../shared/newPlayerCurriculum";
import { resolveCardArtwork } from "../cardArtwork";
import mainBack from "./assets/atlas-cardback-blue.png";
import runeBack from "./assets/atlas-cardback-white.png";
import { BasicsActionDemo, BasicsCostDemo, BasicsIdentityMap, BasicsScoringPictures, BasicsSmallWords } from "./NewPlayerBasicsDemos";
import { AtlasBoardExplorer } from "./AtlasBoardExplorer";
import "./NewPlayerBasics.css";

function Card({ id, name, caption, landscape = false }: { id: string; name: string; caption?: string; landscape?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [hoverRect, setHoverRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const preview = useRef<HTMLDialogElement>(null);
  useEffect(() => setFailed(false), [id]);
  useEffect(() => {
    if (!hoverRect) return;
    const hide = () => setHoverRect(null);
    window.addEventListener("scroll", hide, true); window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [hoverRect]);
  function showHover(element: HTMLElement) {
    if (preview.current?.open || failed) return;
    const anchor = element.getBoundingClientRect(), ratio = landscape ? 1039 / 744 : 744 / 1039;
    const width = Math.min(landscape ? 430 : 320, window.innerWidth - 24, (window.innerHeight - 40) * ratio);
    const right = anchor.right + 14;
    setHoverRect({ width, left: right + width < window.innerWidth - 12 ? right : Math.max(12, anchor.left - width - 14), top: Math.max(12, Math.min(window.innerHeight - width / ratio - 12, anchor.top)) });
  }
  return <figure className={`nph-visual-card ${landscape ? "is-landscape" : ""}`}>
    {failed ? <div className="nph-art-fallback"><Layers3 size={34} /><strong>{name}</strong></div> : <button type="button" className="nph-card-image-button" aria-label={`Enlarge ${name}`} onMouseEnter={event => showHover(event.currentTarget)} onMouseLeave={() => setHoverRect(null)} onFocus={event => showHover(event.currentTarget)} onBlur={() => setHoverRect(null)} onKeyDown={event => { if (event.key === "Escape") setHoverRect(null); }} onClick={() => { setHoverRect(null); preview.current?.showModal(); }}><img src={resolveCardArtwork(id)} alt={name} loading="lazy" onError={() => setFailed(true)} /><span>View card</span></button>}
    <figcaption><strong>{name}</strong>{caption ? <span>{caption}</span> : null}</figcaption>
    <dialog className="nph-basics-card-dialog" ref={preview} aria-label={name} onClick={event => { if (event.target === event.currentTarget) preview.current?.close(); }}><button type="button" onClick={() => preview.current?.close()}>Back to the guide</button><img src={resolveCardArtwork(id)} alt={name} /><strong>{name}</strong>{caption && <p>{caption}</p>}</dialog>
    {hoverRect && !failed ? createPortal(<div className="nph-basics-hover-card" style={hoverRect} aria-hidden="true"><img src={resolveCardArtwork(id)} alt="" /></div>, document.body) : null}
  </figure>;
}

const RUNES: Record<string, string> = { fury: "OGN-007", calm: "OGN-042", mind: "OGN-089", body: "OGN-126", chaos: "OGN-166", order: "OGN-214" };

function PointTrack() {
  return <div className="nph-point-goal"><Flag size={20}/><strong>First to 8 points.</strong><span>Conquer and hold battlefields to get there.</span></div>;
}

function TimingVisual() {
  const [situation, setSituation] = useState<"main" | "showdown" | "chain">("main");
  const situations = [{ id: "main" as const, label: "Your Main phase", note: "It’s your chance to act in Main, with no showdown or waiting effects, so you can make your normal plays." }, { id: "showdown" as const, label: "An open showdown", note: "You’re in a showdown, the chain’s empty and it’s your chance to play something before the battlefield is decided." }, { id: "chain" as const, label: "Responding on the chain", note: "Something’s waiting to resolve and you have priority, so this is your chance to respond before it happens." }];
  const cards = [{ name: "Slow / default", cardId:"OGN-096", cardName:"Watchful Sentry", icon: Layers3, text: "No Action or Reaction permission? Start here.", detail: "Look for an empty chain in your own Main phase and make sure a showdown isn’t already underway.", allowed: situation === "main", tag: "Slow is a nickname, not a printed keyword" }, { name: "Action", cardId:"OGN-004", cardName:"Cleave", icon: Play, text: "You can also play during an open showdown.", detail: "This can be on either player’s turn, provided it’s your chance to act and the chain is empty. You’ll need more than Action to answer a waiting spell.", allowed: situation !== "chain", tag: "Adds showdown timing" }, { name: "Reaction", cardId:"OGN-058", cardName:"Discipline", icon: Zap, text: "You can also answer a waiting spell or ability.", detail: "You can use it in the same windows as Action, or answer a waiting spell when you have priority. The newest response gets to resolve first.", allowed: true, tag: "Includes Action timing" }];
  return <div className="nph-timing-visual"><div className="nph-situation-picker" role="group" aria-label="Choose a timing situation">{situations.map(item => <button key={item.id} type="button" aria-pressed={situation === item.id} onClick={() => setSituation(item.id)}>{item.label}</button>)}</div><p className="nph-situation-note">{situations.find(item => item.id === situation)?.note}</p><div className="nph-speed-cards">{cards.map(({ name, cardId, cardName, icon: Icon, text, detail, allowed, tag }) => <section key={name} data-allowed={allowed}><div className="nph-speed-card-heading"><Card id={cardId} name={cardName}/><div><Icon size={22}/><h3>{name}</h3></div></div><p>{text}</p><strong>{allowed ? "This timing is available" : "Wait for the right window"}</strong><small>{detail}</small><span>{tag}</span></section>)}</div><p className="nph-visual-tip"><Shield size={18} />Once you’ve found the right time, check it’s your chance to act, you can pay and your target is legal.</p><div className="nph-speed-example"><Card id="OGN-058" name="Discipline" caption="Reaction: you can respond with this." /><p>Someone plays a spell.<br /><strong>You don’t have to let it resolve straight away.</strong><br />If you have priority, a Reaction gives you a chance to answer.</p></div></div>;
}

function TriggerTimingVisual() {
  const [stage, setStage] = useState(0);
  const stages = [
    { title: "Finish the move", text: "First move the unit, then check if moving it caused an ability to trigger. Those movement triggers go on the chain before a new fight opens.", reaction: false },
    { title: "Movement triggers", text: "With priority you can answer the trigger with a Reaction. Once both players pass, resolve the newest item and give them another chance on anything that’s left. If a movement effect takes one unit away, do we even have a fight when that chain empties?", reaction: true },
    { title: "Attack and defend triggers", text: "If opposing units are still there, they become attackers and defenders as combat opens. Put any attack triggers on a new chain first, then the defend triggers above them. Players can respond, and as you work through that chain the newest item resolves first each time.", reaction: true },
    { title: "Open showdown choices", text: "Now we’ve got an open showdown. Whoever has focus gets the next chance to play an Action or a Reaction, and if you both pass with the chain empty you can move on to combat damage.", reaction: false }
  ];
  return <section className="nph-trigger-timing" aria-label="Trigger timing before a new combat">
    <span className="nph-eyebrow">ONE THING AT A TIME</span>
    <h3>When a move starts a new combat</h3>
    <p>Check what triggered from the move first, then what triggered from attacking or defending. Both players get a chance to respond as each chain forms.</p>
    <div className="nph-trigger-stages" role="group" aria-label="Explore the trigger order">
      {stages.map((item, index) => <button type="button" key={item.title} aria-pressed={stage === index} onClick={() => setStage(index)}><b>{index + 1}</b><span>{item.title}</span>{index < stages.length - 1 ? <ArrowRight size={16} aria-hidden="true" /> : null}</button>)}
    </div>
    <div className="nph-trigger-detail" aria-live="polite"><div><h4>{stages[stage].title}</h4><p>{stages[stage].text}</p>{stages[stage].reaction ? <strong><Zap size={17} />Players can react to these triggers.</strong> : null}</div><Card id="RAD-050" name="Mysterious Chronomancer" caption="Disarm creates an ability when this unit attacks. That ability can be reacted to." /></div>
    <p className="nph-trigger-note"><strong>Some bonuses just apply.</strong> Assault and Shield change Might when a unit becomes an attacker or defender. They are not triggers waiting on the chain.</p>
    <p className="nph-trigger-note">We’ve started a new fight here. If a unit joins a fight that’s already underway, carry on with that fight and its current chain.</p>
  </section>;
}

function AnatomyVisual() {
  const [part, setPart] = useState(0);
  const parts = [
    { title: "Energy", text: "See the 3 in the top left? We’ll need 3 energy to cover that part of Ahri’s cost.", side: "left", y: 9, box: [4, 3, 18, 12] },
    { title: "Power", text: "Underneath the 3 there’s a Mind symbol, so we’ll need 1 Mind power as well.", side: "left", y: 18, box: [4, 14, 14, 10] },
    { title: "Might", text: "That 3 in the top right is her starting Might, so check whether anything is changing it before you work out combat damage.", side: "right", y: 9, box: [80, 3, 17, 13] },
    { title: "Name and type", text: "Ahri, Inquisitive is a champion unit, so check that type and her tags when an effect asks you to choose a card.", side: "left", y: 55, box: [5, 49, 90, 14] },
    { title: "Rules text", text: "Read through the box once for when the ability happens, then look again for what it actually lets you choose or change.", side: "right", y: 75, box: [5, 64, 90, 25] }
  ];
  const box = parts[part].box;
  return <div className="nph-anatomy-explorer">
    <div className="nph-anatomy-frame"><div className="nph-anatomy-image">
      <img src={resolveCardArtwork("OGN-119")} alt="Ahri, Inquisitive, with its full printed cost, Might, name and rules text visible" />
      <svg className="nph-anatomy-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} rx="1.5" /></svg>
      {parts.map((item, index) => <button type="button" key={item.title} data-side={item.side} style={{ top: `${item.y}%` }} aria-label={`Show ${item.title}`} aria-pressed={index === part} onClick={() => setPart(index)}>{index + 1}</button>)}
    </div></div>
    <div><span className="nph-eyebrow">PICK A NUMBER OR A LABEL</span><div className="nph-anatomy-options">{parts.map((item, index) => <button key={item.title} type="button" onClick={() => setPart(index)} aria-pressed={part === index}><b>{index + 1}</b>{item.title}</button>)}</div><div className="nph-anatomy-detail" aria-live="polite"><h3>{parts[part].title}</h3><p>{parts[part].text}</p></div></div>
  </div>;
}

function FirstMovesVisual() { return <BasicsActionDemo />; }

function TopicVisual({ id, onOpenExternal }: { id: string; onOpenExternal: (url: string) => Promise<void> }) {
  if (id === "first-real-game") return <div className="nph-first-game-faq-visual"><div className="nph-faq-decks"><figure><img src={mainBack} alt="Main deck card back" /><figcaption><strong>Main deck</strong><span>Cards to draw and play</span></figcaption></figure><figure><img src={runeBack} alt="Rune deck card back" /><figcaption><strong>Rune deck</strong><span>Runes to channel for resources</span></figcaption></figure></div><p>Before you do anything about an empty deck, check which one it is. Missing a rune on Channel works differently from needing a card on Draw.</p><BasicsSmallWords /><p>Before you pay or pick a target, try changing one little word and see what that would let you do.</p></div>;
  if (id === "timing") return <><TimingVisual /><TriggerTimingVisual /></>;
  if (id === "board-layout") return <AtlasBoardExplorer />;
  if (id === "card-anatomy") return <><AnatomyVisual /><BasicsCostDemo /><FirstMovesVisual /><p className="nph-cost-reminder"><Zap size={20} /><span><strong>Pay the number and the symbols.</strong> Ahri needs 3 energy <b>and</b> 1 Mind power. Our first two runes can only give us 2 energy, which is why we’ll consider sending the spare Ahri back in the opening-hand lesson.</span></p></>;
  if (id === "domains") return <><div className="nph-domain-identity-intro"><img src={resolveCardArtwork("OGN-255")} alt="Ahri’s legend shows Calm and Mind"/><div><span className="nph-eyebrow">START WITH YOUR LEGEND</span><h3>Ahri uses Calm and Mind.</h3><p>Those two symbols give Ahri her identity, and you’ll see the same ones on the runes and cards her deck can use.</p></div></div><p className="nph-domain-source-note">These descriptions come from Riot’s domain guide. I’d use them to find a style you like, then look at what your particular legend and cards do.</p><div className="nph-domain-gallery">{NEW_PLAYER_DOMAINS.map(domain => <section key={domain.id} style={{ "--domain-color": domain.color } as React.CSSProperties}><img src={resolveCardArtwork(RUNES[domain.id])} alt={`${domain.name} Rune`} loading="lazy" /><div><h3>{domain.name}</h3><strong>{domain.identity}</strong><p>{domain.description}</p></div></section>)}</div><button type="button" className="nph-text-button nph-domain-source" onClick={() => void onOpenExternal(NEW_PLAYER_DOMAIN_SOURCE.url)}>{NEW_PLAYER_DOMAIN_SOURCE.title}<ExternalLink size={14} /></button></>;
  if (id === "legend-and-champion") return <><BasicsIdentityMap /><div className="nph-legend-introduction"><p><strong>Domains are card families.</strong> Ahri’s legend shows Calm and Mind, so those are the domains her deck can use. Domain symbols in a cost tell you which power you need to pay.</p><p><strong>Constructed: the same champion, different cards.</strong> Ahri, Nine-Tailed Fox can pair with Ahri, Inquisitive because they share the Ahri champion tag, even though the rest of their names are different.</p></div></>;

  if (id === "build-a-deck") return <div className="nph-deck-recipe"><div><img src={mainBack} alt="Main deck card back" /><strong>40</strong><span>Main-deck cards</span><small>Count exactly 40 for Constructed, with your chosen champion in that total. Other formats can differ.</small></div><div><img src={runeBack} alt="Rune deck card back" /><strong>12</strong><span>Runes</span><small>A separate deck for your resources.</small></div><div><img src={resolveCardArtwork("OGN-282")} alt="Example battlefield" /><strong>3</strong><span>Different battlefields</span><small>In best of three (BO3) you need two wins. Each player brings three battlefields, changes after a game with a winner and uses the same one again after a draw.</small></div><p className="nph-visual-tip nph-deck-count-example"><img src={resolveCardArtwork("OGN-119")} alt="Ahri, a chosen champion included in the main deck"/><span><strong>1 chosen champion + 39 other cards = 40.</strong>The legend is separate. When you check the rest of the deck, look for matching domains and the normal limit of three copies of each full card name.</span></p></div>;
  if (id === "turns-and-scoring") return <><div className="nph-turn-strip">{["Awaken", "Beginning", "Channel", "Draw", "Main"].map((phase, index) => <span key={phase}><b>{index + 1}</b>{phase}{index < 4 ? <ArrowRight size={16} /> : null}</span>)}</div><BasicsScoringPictures /><p className="nph-visual-tip">Each battlefield can score for you once per turn. If you’re on 7 points, holding can win on its own. For a conquer to win you need to have scored every battlefield that turn, otherwise you draw a card.</p></>;
  if (id === "ready-to-play") return <div className="nph-ready-steps">{[{ icon: Layers3, title: "Set up the table", text: "Place your legend, choose a battlefield and draw your opening hand." }, { icon: Play, title: "Make the moves", text: "We’ll pay for our first unit, take it into a fight and work towards the winning point." }, { icon: Flag, title: "Then choose a deck", text: "Once you’ve played the guided game, try a creator guide or pick a deck to take to Atlas." }].map(({ icon: Icon, title, text }, i) => <section key={title}><b>0{i + 1}</b><img className="nph-ready-art" src={i===0?resolveCardArtwork("OGN-255"):i===1?resolveCardArtwork("OGN-096"):mainBack} alt={i===0?"Ahri, your legend":i===1?"Watchful Sentry, a unit you will play":"Your main deck"}/><Icon size={22} /><h3>{title}</h3><p>{text}</p></section>)}</div>;
  return <><PointTrack /><FirstMovesVisual /><div className="nph-game-at-a-glance"><Card id="OGN-119" name="Play your units" caption="Play your units onto the table." /><ArrowRight size={25} /><Card id="OGN-282" name="Conquer and hold battlefields" caption="Conquering and holding score points." landscape /></div></>;
}

function TopicRules({topic}: {topic: NewPlayerTopic}) {
  if (topic.id === "first-real-game") return <section className="nph-faq-questions" aria-label="Questions from your first real game">{topic.rules?.map(rule => <details key={rule.title}><summary>{rule.title}</summary><ul>{rule.points.map(point => <li key={point}>{point}</li>)}</ul></details>)}</section>;
  return <details key={topic.id} className="nph-more-detail"><summary>A bit more detail</summary>{topic.rules?.length ? <div className="nph-rule-sections">{topic.rules.map(rule => <section key={rule.title}><h4>{rule.title}</h4><ul>{rule.points.map(point => <li key={point}>{point}</li>)}</ul></section>)}</div> : topic.paragraphs.map((text, i) => <p key={i}>{text}</p>)}</details>;
}

export function NewPlayerBasics({ topicId, readTopicIds, onTopic, onRead, onOpenExternal, returnToQuiz, children }: { topicId: string; readTopicIds: string[]; onTopic: (id: string) => void; onRead: (topic: NewPlayerTopic) => void; onOpenExternal: (url: string) => Promise<void>; returnToQuiz?: boolean; children?: React.ReactNode }) {
  const topic = NEW_PLAYER_BASICS.find(item => item.id === topicId) ?? NEW_PLAYER_BASICS[0];
  const alreadyRead = readTopicIds.includes(topic.id);
  const next = nextUnreadBasicsTopic(topic.id, readTopicIds);
  const destination = returnToQuiz ? "Knowledge check" : next?.title ?? "Guided game";
  const continueLabel = alreadyRead ? "Continue" : "Mark as read and continue";
  const article = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    article.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [topic.id]);
  return <div className="nph-reading-layout nph-visual-basics">
    <nav className="nph-topics" aria-label="Riftbound basics">
      {NEW_PLAYER_BASICS.map((item, index) => <button type="button" key={item.id}
        aria-current={item.id === topic.id ? "page" : undefined}
        aria-label={`${index + 1}. ${item.title}${readTopicIds.includes(item.id) ? " · Read" : ""}`}
        onClick={() => onTopic(item.id)}>
        <span>{String(index + 1).padStart(2, "0")}</span>{item.title}
        {readTopicIds.includes(item.id) ? <Check size={16} /> : <ChevronRight size={16} />}
      </button>)}
    </nav>
    <section className="nph-basics-panel" aria-label="Read and continue">
      <article className="nph-visual-article" data-topic={topic.id} ref={article} tabIndex={0} aria-label={`${topic.title} — scroll to explore`}>
        <header><span className="nph-eyebrow">The basics · {NEW_PLAYER_BASICS.indexOf(topic) + 1} / {NEW_PLAYER_BASICS.length}{alreadyRead && " · Already read"}</span><h2 ref={heading} tabIndex={-1}>{topic.title}</h2><p>{topic.summary}</p></header>
        <TopicVisual key={`visual:${topic.id}`} id={topic.id} onOpenExternal={onOpenExternal} />{topic.examples?.length ? <div className="nph-topic-examples">{topic.examples.map(example => <section key={example.title}><span className="nph-eyebrow">AT THE TABLE</span><h3>{example.title}</h3><p>{example.text}</p>{example.cards?.length ? <div className="nph-example-cards" aria-label={`Cards for ${example.title}`}>{example.cards.map(card => <Card key={`${card.id}:${card.name}`} {...card} />)}</div> : null}</section>)}</div> : null}<ul className="nph-quick-takeaways">{topic.takeaways.map(item => <li key={item}><Check size={18} />{item}</li>)}</ul><TopicRules key={topic.id} topic={topic} />{children}</article>
      <footer className="nph-basics-next">
        <p>{readTopicIds.length} of {NEW_PLAYER_BASICS.length} topics read · Next: {destination}</p>
        <button type="button" className="nph-primary" onClick={() => onRead(topic)}>{continueLabel}<ArrowRight size={16} /></button>
        <div className="nph-rule-links">{NEW_PLAYER_RULE_SOURCES.slice(0, 2).map(source => <button type="button" className="nph-text-button" key={source.url} onClick={() => void onOpenExternal(source.url)}>{source.title}<ExternalLink size={12} /></button>)}</div></footer></section></div>;
}

