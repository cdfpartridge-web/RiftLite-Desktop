import React, { useState } from 'react';
import { ArrowRight, Check, Flag, Layers3, Plus, RotateCcw, Shield, Zap } from 'lucide-react';
import type { TutorialBoard, TutorialCard, TutorialStep } from '../../shared/newPlayerTutorial';
import cardRegistry from '../../../resources/riftbound_card_registry.json';
import { NEW_PLAYER_KEYWORD_SCENARIOS } from '../../shared/newPlayerKeywordScenarios';
import { resolveCardArtwork } from '../cardArtwork';
import { getLessonVisual } from './newPlayerLessonVisuals';
import { isTeachingCardVisible, TEACHING_ZONE_LABELS } from './newPlayerVisualTeaching';
import mainBack from './assets/atlas-cardback-blue.png';
import './NewPlayerVisualTeaching.css';

const printedCards = new Map(cardRegistry.cards.map(card => [card.printId, card]));

function CardPicture({cardId, name, imageUrl, sideways = false, focusCost = false}: {cardId?: string; name: string; imageUrl?: string; sideways?: boolean; focusCost?: boolean}) {
  return <div className="nph-illustration-card" data-sideways={sideways || undefined}><img src={cardId ? resolveCardArtwork(cardId, imageUrl) : mainBack} alt={name} draggable={false}/>{focusCost && <span className="nph-illustration-cost-focus" aria-hidden="true"/>}</div>;
}

/** A replayable illustration, independent of the tutorial state and its saved actions. */
export function LessonIllustration({lessonId, board, step}: {lessonId: string; board: TutorialBoard; step?: TutorialStep}) {
  const [replay, setReplay] = useState(0);
  const visual = getLessonVisual(lessonId);
  const scenario = NEW_PLAYER_KEYWORD_SCENARIOS.find(item => item.id === step?.keywordScenarioId);
  const publicCards = board.cards.filter(isTeachingCardVisible);
  // Intro pictures use explicitly authored examples, never the identities of hidden live cards.
  const illustrationCard = (id: string) => {
    const printed = printedCards.get(id);
    const visible = publicCards.find(card => card.cardId === id);
    return {cardId: id, name: printed?.name ?? visible?.name ?? 'Lesson card', imageUrl: printed?.imageUrl ?? visible?.imageUrl,
      energyCost: printed?.costEnergy ?? visible?.energyCost, powerCost: printed?.costPower ?? visible?.powerCost,
      domain: visible?.domain};
  };
  const primary = illustrationCard(visual.cardId);
  const secondary = illustrationCard(visual.secondCardId ?? visual.cardId);
  const costExample = ['pay','power'].includes(visual.kind) && printedCards.get(visual.cardId)?.type === 'Rune' ? secondary : primary;
  const visibleExample = ['pay','power'].includes(visual.kind) ? costExample : visual.kind === 'counter' ? secondary : primary;
  const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const keywordCards = scenario?.before.cards.filter(card => !card.faceDown && card.zone !== 'hidden' && !(card.owner === 'opponent' && ['hand','deck','rune-deck'].includes(card.zone))) ?? [];
  const printedKeywordCard = keywordCards.find(card => card.keywords?.some(keyword => normalise(keyword) === normalise(scenario!.keyword)))
    ?? keywordCards.find(card => normalise(card.text ?? '').includes(normalise(scenario!.keyword)))
    ?? keywordCards.find(card => card.owner === 'player' && card.type !== 'rune' && card.type !== 'legend');
  const affectedUnit = keywordCards.find(card => card.type === 'unit' && scenario?.after.cards.some(after => after.instanceId === card.instanceId && typeof after.might === 'number' && after.might !== card.might));
  const keywordCard = affectedUnit && (printedKeywordCard?.type !== 'unit' || scenario?.keyword === 'Disarm') ? affectedUnit : printedKeywordCard;
  const example = keywordCard ?? visibleExample;
  const resultCard = scenario?.after.cards.find(card => card.instanceId === keywordCard?.instanceId);
  const resultVisible = resultCard && !resultCard.faceDown && resultCard.zone !== 'hidden' && !(resultCard.owner === 'opponent' && ['hand','deck','rune-deck'].includes(resultCard.zone));
  const kind = scenario ? 'keyword' : visual.kind;
  const cardName = example?.name ?? 'Card in this lesson';
  const from = scenario ? 'Before the keyword matters' : visual.from;
  const to = scenario ? 'After the example' : visual.to;
  const showCost = ['read','pay','power'].includes(kind);
  const showBattlefield = ['move','score','hold','win','hidden'].includes(kind) && lessonId !== 'champion-destinations';
  const field = board.battlefields.find(item => item.cardId === visual.secondCardId) ?? board.battlefields[0];
  const rightCard = kind === 'counter' ? primary : kind === 'chain' && !['keyword-timing','unit-play-effects'].includes(lessonId) ? primary : secondary;
  const pairedCards = ['setup','equipment','growth','read'].includes(kind) || lessonId === 'mulligan-practice';
  const rightName = kind === 'chain' && lessonId === 'unit-play-effects' ? 'Waiting play ability' : rightCard.name;
  const showingReadyChange = !!keywordCard && !!resultCard && keywordCard.ready !== resultCard.ready;
  const summary = scenario ? scenario.objective?.with ?? scenario.explanation : visual.summary;
  const keywordChanges = scenario ? ([['energy','Energy'],['power','Power'],['score','Points'],['handCount','Cards in hand'],['xp','Experience']] as const).flatMap(([key,label]) => {
    const before = scenario.before.player[key], after = scenario.after.player[key];
    return typeof before === 'number' && typeof after === 'number' && before !== after ? [{label,before,after}] : [];
  }) : [];
  const stats = (card: typeof keywordCard) => card ? <span className="nph-illustration-stats">{card.type === 'unit' && typeof card.might === 'number' ? <span><Shield size={12}/>{card.might} Might{card.damage ? ` · ${card.damage} damage` : ''}</span> : null}<span>{TEACHING_ZONE_LABELS[card.zone as TutorialCard['zone']] ?? card.zone}{showingReadyChange ? ` · ${card.ready ? 'ready' : 'exhausted'}` : ''}</span></span> : null;
  return <section className="nph-lesson-illustration" data-kind={kind} aria-label={scenario ? `${scenario.keyword} illustrated example` : 'Picture the lesson'}>
    <header><span>{scenario ? 'SEE THE DIFFERENCE' : 'PICTURE THE LESSON'}</span><button type="button" onClick={() => setReplay(value => value + 1)} aria-label="Replay lesson illustration"><RotateCcw size={13}/>Replay</button></header>
    <div className="nph-illustration-scene" key={`${lessonId}-${scenario?.id ?? ''}-${replay}`} data-replay={replay > 0 || undefined}>
      {kind === 'turn' ? <div className="nph-illustration-abcd">{[['A','Awaken','Ready your used cards'],['B','Beginning','Check abilities and holding'],['C','Channel','Bring runes out'],['D','Draw','Add a card to your hand']].map(([letter,title,detail],index) => <div key={letter}><strong>{letter}</strong><span>{title}<small>{detail}</small></span>{index === 2 ? <img src={resolveCardArtwork(primary.cardId)} alt={primary.name}/> : index === 3 ? <img src={mainBack} alt="Main deck card back"/> : null}</div>)}</div> : showCost ? <>
        <figure className="nph-illustration-cost-card"><CardPicture cardId={example?.cardId} imageUrl={example?.imageUrl} name={cardName} focusCost/><figcaption>{cardName}</figcaption></figure>
        <div className="nph-illustration-cost-route"><span><Zap size={17}/>{from}</span><ArrowRight size={20}/><span><Check size={17}/>{to}</span>{example && 'energyCost' in example && typeof example.energyCost === 'number' && <strong>{example.energyCost} energy{example.powerCost ? ` + ${example.powerCost} ${'domain' in example && example.domain ? `${example.domain} ` : ''}power` : ''}<small>Printed cost</small></strong>}{kind === 'power' && <img className="nph-illustration-rune" src={resolveCardArtwork(primary.cardId)} alt={primary.name}/>}</div>
      </> : <>
        <div className="nph-illustration-position"><span>{from}</span><CardPicture cardId={example?.cardId} imageUrl={example?.imageUrl} name={cardName} sideways={scenario ? showingReadyChange && !keywordCard?.ready : false}/>{scenario ? stats(keywordCard) : <small>{cardName}</small>}</div>
        {kind === 'combat' && lessonId !== 'damage-and-might' ? <span className="nph-illustration-arrow" aria-label="Opposing units">vs</span> : pairedCards ? <Plus className="nph-illustration-arrow" size={21} aria-label="Compare these cards"/> : <ArrowRight className="nph-illustration-arrow" size={23}/>}
        <div className="nph-illustration-position" data-result="true">
          <span>{to}</span>
          {showBattlefield && field ? <div className="nph-illustration-battlefield"><img src={resolveCardArtwork(field.cardId, field.imageUrl)} alt={field.name}/><CardPicture cardId={kind === 'hidden' ? undefined : primary.cardId} name={kind === 'hidden' ? 'Face-down Hidden card' : primary.name} sideways={kind === 'move'}/>{['score','hold','win'].includes(kind) && <Flag size={18}/>}<small>{field.name}</small></div>
            : lessonId === 'unit-play-effects' && !scenario ? <div className="nph-illustration-ability"><Layers3 size={32}/><strong>Play ability</strong><small>Already on the chain</small></div>
            : <CardPicture cardId={scenario ? resultVisible ? resultCard?.cardId : undefined : lessonId === 'damage-and-might' ? primary.cardId : rightCard.cardId} imageUrl={scenario ? resultCard?.imageUrl : undefined} name={scenario && !resultVisible ? 'Concealed or removed card' : scenario ? cardName : rightName} sideways={scenario ? showingReadyChange && !resultCard?.ready : false}/>}
          {scenario ? stats(resultVisible ? resultCard : undefined) : <small>{kind === 'chain' || kind === 'counter' ? 'Resolve the newest item first' : kind === 'mulligan' ? 'Example cards · replacements vary' : showBattlefield ? kind === 'hidden' ? 'Only at this battlefield' : 'Check the showdown and scoring rules' : lessonId === 'damage-and-might' ? 'Marked damage does not subtract Might' : rightName}</small>}
        </div>
      </>}
    </div>
    {scenario && printedKeywordCard && printedKeywordCard !== keywordCard && <div className="nph-illustration-cause"><img src={resolveCardArtwork(printedKeywordCard.cardId, printedKeywordCard.imageUrl)} alt={printedKeywordCard.name}/><span>{printedKeywordCard.name}<small>The card making the difference</small></span></div>}
    {keywordChanges.length > 0 && <div className="nph-illustration-change-strip" aria-label="Example resource changes">{keywordChanges.map(change => <span key={change.label}>{change.label}<b>{change.before}<ArrowRight size={12}/>{change.after}</b></span>)}</div>}
    <p className="nph-illustration-meaning"><Layers3 size={15}/><span>{summary}</span></p>
    <small className="nph-illustration-caption">{scenario ? 'Preview of this separate example. You will make the plays on the board.' : 'A picture of the idea. Your own moves happen on the board.'}</small>
  </section>;
}
