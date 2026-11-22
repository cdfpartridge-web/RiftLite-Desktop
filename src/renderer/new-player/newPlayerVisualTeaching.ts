import type { TutorialAction, TutorialBoard, TutorialCard, TutorialGuideEffect, TutorialState, TutorialStep, TutorialZone } from '../../shared/newPlayerTutorial';

export const TEACHING_ZONE_LABELS: Record<TutorialZone, string> = {
  setup: 'Before setup', hand: 'Hand', base: 'Base', champion: 'Champion zone', legend: 'Legend zone',
  runes: 'Runes', trash: 'Trash', hidden: 'Hidden at a battlefield', deck: 'Main deck', 'rune-deck': 'Rune deck',
  chain: 'Chain', banishment: 'Banishment', 'battlefield-left': 'Left battlefield', 'battlefield-right': 'Right battlefield',
};

/** Teaching pictures follow the same public-information boundary as the board reader. */
export function isTeachingCardVisible(card: TutorialCard | undefined): card is TutorialCard {
  return !!card && !card.faceDown && card.zone !== 'hidden' && !(card.owner === 'opponent' && ['hand', 'deck', 'rune-deck'].includes(card.zone)) && card.zone !== 'deck' && card.zone !== 'rune-deck';
}

export interface StepTeachingVisual {
  card?: TutorialCard;
  back?: 'main' | 'rune';
  from: string;
  to: string;
  kind: 'read' | 'move' | 'turn' | 'resource' | 'chain' | 'score';
  gesture: string;
}

function guideAction(effect: TutorialGuideEffect | undefined): TutorialAction | undefined {
  if (!effect) return undefined;
  switch (effect.type) {
    case 'play': return {type: 'play', cardId: effect.cardId, destination: effect.destination, targetId: effect.targetId};
    case 'move': return {type: 'move', cardId: effect.cardId, destination: effect.destination};
    case 'exhaust': return {type: 'exhaust', cardId: effect.cardId};
    case 'draw': case 'draw-card': return {type: 'draw'};
    case 'channel': return {type: 'channel', ready: true};
    case 'ready': return {type: 'ready'};
    case 'score': return {type: 'score'};
    case 'pass': return {type: 'pass'};
    case 'resolve': return {type: 'resolve'};
    default: return undefined;
  }
}

/** Describes the next gesture only. It never simulates, pays, or dispatches an action. */
export function getStepTeachingVisual(state: TutorialState, step: TutorialStep): StepTeachingVisual | null {
  const raw = step.boardAction ?? step.expectedAction;
  const effect = raw.type === 'guide' ? step.guideEffect : undefined;
  if (effect?.type === 'exhaust-runes') {
    const runes = effect.cardIds.map(id => state.board.cards.find(card => card.instanceId === id));
    const count = effect.cardIds.length;
    if (!count) return null;
    const first = runes[0];
    const owner = first?.owner === 'player' ? 'Your' : 'Guide’s';
    return {card: isTeachingCardVisible(first) ? first : undefined, from: `${owner} ${count} ready rune${count === 1 ? '' : 's'}`, to: `+${count} energy · rune${count === 1 ? '' : 's'} stay${count === 1 ? 's' : ''}`, kind: 'turn', gesture: `Watch ${count === 1 ? 'the rune turn' : `${count} runes turn`} sideways${count > 1 ? ' together' : ''}.`};
  }
  const action = raw.type === 'guide' ? guideAction(effect) : raw;
  if (!action) return null;
  const source = 'cardId' in action ? state.board.cards.find(card => card.instanceId === action.cardId) : undefined;
  const automatic = raw.type === 'guide' || step.actor === 'guide' || step.actor === 'rules';
  const effectCard = effect && 'cardId' in effect ? state.board.cards.find(card => card.instanceId === effect.cardId) : undefined;
  const side = effect && 'side' in effect ? effect.side : source?.owner ?? effectCard?.owner ?? (step.actor === 'guide' ? 'opponent' : 'player');
  const owner = side === 'opponent' ? 'Guide’s' : 'Your';
  const card = isTeachingCardVisible(source) ? source : undefined;
  const base = {card, back: source && !card ? 'main' as const : undefined};
  const zone = (value?: TutorialZone) => value ? TEACHING_ZONE_LABELS[value] : 'The table';
  switch (action.type) {
    case 'inspect': return { ...base, from: card ? card.name : 'Highlighted space', to: 'Read, then click', kind: 'read', gesture: card?.zone === 'chain' ? `Select ${card.name} in the Chain list to inspect it.` : 'Click when you have finished reading.' };
    case 'exhaust': return {...base, from: automatic ? `${owner} ready rune` : 'Ready rune', to: '+1 energy · rune stays', kind: 'turn', gesture: automatic ? 'Watch the rune turn sideways.' : 'Tap or click the highlighted rune.'};
    case 'recycle': return {...base, from: source?.ready ? 'Ready rune' : 'Exhausted rune', to: `${card?.domain ?? 'Matching'} power · rune returns`, kind: 'resource', gesture: 'Select the rune, then choose Recycle in Card actions.'};
    case 'play': return {...base, from: zone(source?.zone), to: action.destination ? zone(action.destination) : card?.type === 'spell' ? 'Chain' : 'Base', kind: action.destination === 'chain' || card?.type === 'spell' ? 'chain' : 'move', gesture: automatic ? `Watch ${side === 'opponent' ? 'the guide’s' : 'your'} card enter play.` : action.destination?.startsWith('battlefield-') ? 'Select the card, then the highlighted battlefield.' : action.targetId ? 'Select the card, then its highlighted target.' : 'Click the highlighted card to play it.'};
    case 'move': return {...base, from: zone(source?.zone), to: zone(action.destination), kind: 'move', gesture: automatic ? `Watch ${side === 'opponent' ? 'the guide’s' : 'your'} unit move.` : 'Drag the unit, or select it and its destination.'};
    case 'move-units': {
      const first = state.board.cards.find(item => item.instanceId === action.cardIds[0]);
      return {card: isTeachingCardVisible(first) ? first : undefined, from: `${action.cardIds.length} units together`, to: zone(action.destination), kind: 'move', gesture: 'Select the units, then click the battlefield.'};
    }
    case 'draw': return {back: 'main', from: automatic ? `${owner} main deck` : 'Main deck', to: automatic ? `${owner} hand` : 'Hand', kind: 'move', gesture: automatic ? `Watch ${side === 'opponent' ? 'the guide draw' : 'the draw of'} ${effect?.type === 'draw' ? effect.count : 1} card${effect?.type === 'draw' && effect.count !== 1 ? 's' : ''}.` : 'Click your Main Deck to draw.'};
    case 'channel': return {back: 'rune', from: automatic ? `${owner} rune deck` : 'Rune deck', to: automatic ? `${owner} ${effect?.type === 'channel' ? effect.count : ''} ready runes` : action.ready ? 'Ready runes' : 'Exhausted runes', kind: 'move', gesture: automatic ? 'Watch the runes enter ready.' : action.ready ? 'Choose Channel ready runes.' : 'Choose Channel exhausted runes.'};
    case 'ready': return {from: automatic ? `${owner} exhausted cards` : 'Exhausted', to: automatic ? `${owner} cards ready` : 'Ready to use again', kind: 'turn', gesture: automatic ? 'Watch those cards turn upright.' : 'Choose Awaken · ready all.'};
    case 'check-beginning': return {from: 'Beginning effects', to: 'Check holding', kind: 'score', gesture: 'Choose Check Beginning.'};
    case 'pass': return {from: `${owner} ${state.board.chain.length ? 'priority' : 'focus'}`, to: 'Add no response now', kind: 'chain', gesture: automatic ? `${side === 'opponent' ? 'The guide passes' : 'Watch the pass of'} ${state.board.chain.length ? 'priority' : 'focus'}.` : `Click ${state.board.chain.length ? 'Pass priority' : 'Pass focus'}.`};
    case 'resolve': return {from: state.board.chain.length ? 'Newest waiting item' : 'Combat damage', to: state.board.chain.length ? 'Its effect happens' : 'Both sides deal damage', kind: 'chain', gesture: automatic ? 'Watch the waiting effect happen.' : 'Click Resolve beside the chain.'};
    case 'score': return {from: 'Battlefield controlled', to: 'Check this turn’s scoring', kind: 'score', gesture: automatic ? `Watch ${side === 'opponent' ? 'the guide’s' : 'your'} scoring check.` : state.board.phase === 'Beginning' ? 'Choose Hold + Score.' : 'Choose Conquer beside the battlefield.'};
    case 'hide': return {...base, from: 'Hand', to: `Hidden · ${zone(action.battlefieldId).toLowerCase()}`, kind: 'move', gesture: 'Use Hide, then select the highlighted battlefield.'};
    case 'activate': return {...base, from: 'Card ability', to: 'Follow its cost and effect', kind: 'chain', gesture: 'Select the card and choose Activate ability, or Shift + click it.'};
    case 'choose-trigger': return {...base, from: 'Waiting ability', to: 'Choose its target', kind: 'chain', gesture: 'Click the highlighted target.'};
    case 'spend-buff': return {...base, from: 'Buff counter', to: 'Pay for the ability', kind: 'chain', gesture: 'Click the unit to spend its Buff.'};
    case 'predict': return {...base, from: 'Look at the top card', to: 'Keep it or recycle it', kind: 'read', gesture: 'Choose in the open deck drawer.'};
    case 'remove-draft-copy': return {...base, from: 'Deck restriction', to: 'Remove the extra copy', kind: 'read', gesture: 'Open your Main Deck, then choose Remove duplicate.'};
    case 'mulligan': return {back: 'main', from: 'Opening four', to: 'Keep or replace up to two', kind: 'move', gesture: 'Select cards, then confirm your choice.'};
    case 'setup': return {...base, back: action.item === 'rune-deck' ? 'rune' : base.back, from: 'Your next piece', to: zone(action.destination), kind: 'move', gesture: action.destination ? 'Drag the piece to its outlined space.' : 'Choose the highlighted setup action.'};
    case 'end-turn': return {from: 'Your turn ends', to: 'Guide’s turn begins', kind: 'turn', gesture: 'Choose End Turn when you are finished.'};
    default: return null;
  }
}

export interface TeachingChange { key: string; label: string; from: string; to: string; card?: TutorialCard }

/** Compare public, completed changes; never reveal a future action or concealed card. */
export function getTeachingChanges(before: TutorialBoard | undefined, after: TutorialBoard): TeachingChange[] {
  if (!before) return [];
  if (before.keywordScenario?.id !== after.keywordScenario?.id || before.foundation?.lessonId !== after.foundation?.lessonId || before.foundation?.variant !== after.foundation?.variant || before.practice?.title !== after.practice?.title || after.turn < before.turn || (['player', 'opponent'] as const).some(side => after.players[side].score < before.players[side].score)) {
    return [{key: 'position-reset', label: 'A separate example', from: 'Previous position', to: 'New teaching position'}];
  }
  const changes: TeachingChange[] = [];
  for (const side of ['player', 'opponent'] as const) {
    const name = side === 'player' ? 'Your' : 'Guide’s';
    for (const resource of ['score', 'energy'] as const) {
      if (before.players[side][resource] !== after.players[side][resource]) changes.push({key: `${side}-${resource}`, label: `${name} ${resource === 'score' ? 'points' : 'energy'}`, from: String(before.players[side][resource]), to: String(after.players[side][resource])});
    }
    for (const domain of ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] as const) {
      const old = before.players[side].power[domain] ?? 0, current = after.players[side].power[domain] ?? 0;
      if (old !== current) changes.push({key: `${side}-${domain}`, label: `${name} ${domain} power`, from: String(old), to: String(current)});
    }
  }
  for (const card of after.cards) {
    const currentId = card.instanceId, currentZone = card.zone;
    const old = before.cards.find(item => item.instanceId === card.instanceId);
    if (!isTeachingCardVisible(card) && !isTeachingCardVisible(old)) continue;
    // A public card moving away remains known; never read its new concealed identity or values.
    if (!isTeachingCardVisible(card)) {
      if (isTeachingCardVisible(old) && old.zone !== currentZone) changes.push({key: `${currentId}-zone`, label: old.name, from: TEACHING_ZONE_LABELS[old.zone], to: TEACHING_ZONE_LABELS[currentZone], card: old});
      continue;
    }
    const visible = isTeachingCardVisible(card) ? card : isTeachingCardVisible(old) ? old : undefined;
    if (!visible) continue;
    if (old && old.zone !== card.zone) changes.push({key: `${card.instanceId}-zone`, label: visible.name, from: TEACHING_ZONE_LABELS[old.zone], to: TEACHING_ZONE_LABELS[card.zone], card: visible});
    else if (isTeachingCardVisible(old) && old.ready !== card.ready && ['unit', 'rune'].includes(card.type)) changes.push({key: `${card.instanceId}-ready`, label: visible.name, from: old.ready ? 'Ready' : 'Exhausted', to: card.ready ? 'Ready' : 'Exhausted', card: visible});
    else if (isTeachingCardVisible(old) && old.might !== card.might) changes.push({key: `${card.instanceId}-might`, label: `${visible.name} · Might`, from: String(old.might), to: String(card.might), card: visible});
    else if (isTeachingCardVisible(old) && old.damage !== card.damage) changes.push({key: `${card.instanceId}-damage`, label: `${visible.name} · damage`, from: String(old.damage), to: String(card.damage), card: visible});
    else if (!old && isTeachingCardVisible(card)) changes.push({key: `${card.instanceId}-new`, label: visible.name, from: 'New card', to: TEACHING_ZONE_LABELS[card.zone], card: visible});
  }
  return changes.slice(0, 3);
}
