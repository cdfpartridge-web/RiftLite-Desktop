import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FloatingTutorialCoach } from '../src/renderer/new-player/FloatingTutorialCoach';
import { AtlasTutorialBoard } from '../src/renderer/new-player/AtlasTutorialBoard';
import { NewPlayerCourseIntro } from '../src/renderer/new-player/NewPlayerCourseIntro';
import { getStepTeachingVisual, getTeachingChanges } from '../src/renderer/new-player/newPlayerVisualTeaching';
import { applyTutorialAction, createLessonState, getTutorialStep, LESSONS, type TutorialAction, type TutorialGuideEffect, type TutorialStep } from '../src/shared/newPlayerTutorial';

const stepFor = (expectedAction: TutorialAction, extra: Partial<TutorialStep> = {}): TutorialStep => ({
  id: 'visual-check', title: 'Check', instruction: 'Follow this action.', hint: 'Check the board.',
  label: 'Continue', focusIds: [], expectedAction, ...extra,
});
const guideStep = (guideEffect: TutorialGuideEffect) => stepFor({type: 'guide', eventId: 'visual-check'}, {actor: 'guide', guideEffect});

describe('first guided game setup', () => {
  it('keeps the setup picture in the opening and the match-format explanation in the guide, clear of board controls', () => {
    const opening = createLessonState('table-setup');
    const noop = () => {};
    const intro = renderToStaticMarkup(<NewPlayerCourseIntro tutorial={opening} narrationMode="manual" onNarrationMode={noop} paceWarning="" onBack={noop} onStart={noop} />);
    expect(intro).toContain('eight points by conquering and holding battlefields');
    expect(intro).toContain('Replay lesson illustration');
    const state = applyTutorialAction(opening, {type: 'continue'});
    const step = getTutorialStep(state)!;
    expect(step.expectedAction).toMatchObject({type: 'inspect', cardId: 'player:base'});
    const lesson = LESSONS.find(item => item.id === state.lessonId)!;
    const coach = renderToStaticMarkup(<FloatingTutorialCoach lesson={lesson} state={state} step={step} onContinue={noop} onNext={noop} lastLesson={false} />);
    expect(coach).toContain('best-of-three (BO3)');
    expect(coach).toContain('best-of-one (BO1)');
    const board = renderToStaticMarkup(<AtlasTutorialBoard state={state} step={step} onAction={noop} />);
    expect(board).not.toContain('Match format');
    expect(board).not.toContain('best-of-three');
  });
});

describe('next action teaching pictures', () => {
  it('shows the full simultaneous rune payment, with no instruction to take over the guide', () => {
    const state = createLessonState('the-chain');
    const visual = getStepTeachingVisual(state, guideStep({type: 'exhaust-runes', cardIds: ['o-rune-1', 'o-rune-2']}))!;
    expect(visual.from).toBe('Guide’s 2 ready runes');
    expect(visual.to).toBe('+2 energy · runes stay');
    expect(visual.gesture).toContain('2 runes turn sideways together');
    expect(visual.gesture).not.toContain('click');
    const three = getStepTeachingVisual(state, guideStep({type: 'exhaust-runes', cardIds: ['o-rune-1', 'o-rune-2', 'o-rune-3']}))!;
    expect(three.to).toContain('+3 energy');
    expect(three.gesture).toContain('3 runes');
    expect(getStepTeachingVisual(state, guideStep({type: 'exhaust-runes', cardIds: []}))).toBeNull();
  });

  it('identifies the guide’s pass in either response window, including a second pass', () => {
    const state = createLessonState('the-chain');
    state.board.chain = [];
    expect(getStepTeachingVisual(state, guideStep({type: 'pass', side: 'opponent'}))!.from).toBe('Guide’s focus');
    state.board.chain = [{id: 'waiting', cardId: 'OGN-058', controller: 'player', label: 'Discipline'}];
    state.board.passedBy = ['player'];
    const visual = getStepTeachingVisual(state, guideStep({type: 'pass', side: 'opponent'}))!;
    expect(visual.from).toBe('Guide’s priority');
    expect(visual.to).toBe('Add no response now');
    expect(visual.gesture).toBe('The guide passes priority.');
    expect(getStepTeachingVisual(state, stepFor({type: 'pass'}))!.from).toBe('Your priority');
  });

  it('uses the correct deck, owner and quantity for automatic draw and channel', () => {
    const state = createLessonState('the-chain');
    const draw = getStepTeachingVisual(state, guideStep({type: 'draw', side: 'opponent', count: 2}))!;
    expect(draw).toMatchObject({back: 'main', from: 'Guide’s main deck', to: 'Guide’s hand', gesture: 'Watch the guide draw 2 cards.'});
    expect(draw.card).toBeUndefined();
    const channel = getStepTeachingVisual(state, guideStep({type: 'channel', side: 'opponent', count: 3}))!;
    expect(channel).toMatchObject({back: 'rune', from: 'Guide’s rune deck', to: 'Guide’s 3 ready runes'});
    expect(channel.gesture).not.toContain('click');
    const rulesDraw = getStepTeachingVisual(state, {...guideStep({type: 'draw', side: 'player', count: 1}), actor: 'rules'})!;
    expect(rulesDraw.from).toBe('Your main deck');
    expect(rulesDraw.to).toBe('Your hand');
  });

  it('does not display a concealed card identity in the upcoming action', () => {
    const state = createLessonState('the-chain');
    const secret = state.board.cards.find(card => card.owner === 'opponent' && card.zone === 'hand')!;
    secret.name = 'Unrevealed secret identity'; secret.faceDown = true;
    const visual = getStepTeachingVisual(state, guideStep({type: 'play', cardId: secret.instanceId, destination: 'chain'}))!;
    expect(visual.card).toBeUndefined();
    expect(visual.back).toBe('main');
    expect(JSON.stringify(visual)).not.toContain(secret.name);
  });

  it('distinguishes combat damage from resolving an item on the chain', () => {
    const state = createLessonState('combat-damage');
    state.board.chain = [];
    expect(getStepTeachingVisual(state, stepFor({type: 'resolve'}))!.to).toBe('Both sides deal damage');
    state.board.chain = [{id: 'waiting', cardId: 'OGN-058', controller: 'player', label: 'Discipline'}];
    expect(getStepTeachingVisual(state, stepFor({type: 'resolve'}))!.from).toBe('Newest waiting item');
  });
});

describe('completed public change receipts', () => {
  it('reports public energy and matching power independently', () => {
    const before = createLessonState('power-and-champion').board, after = structuredClone(before);
    after.players.player.energy = before.players.player.energy + 1;
    after.players.player.power.Mind = (before.players.player.power.Mind ?? 0) + 1;
    expect(getTeachingChanges(before, after).map(item => item.label)).toEqual(['Your energy', 'Your Mind power']);
  });

  it('keeps only the old public image when a rune is recycled into its concealed deck', () => {
    const before = createLessonState('power-and-champion').board, after = structuredClone(before);
    const old = before.cards.find(card => card.type === 'rune' && card.owner === 'player')!;
    const hidden = after.cards.find(card => card.instanceId === old.instanceId)!;
    hidden.zone = 'rune-deck'; hidden.name = 'Secret new identity'; hidden.cardId = 'SECRET'; hidden.might = 999; hidden.damage = 777;
    const receipt = getTeachingChanges(before, after).find(item => item.key === `${old.instanceId}-zone`)!;
    expect(receipt).toMatchObject({label: old.name, from: 'Runes', to: 'Rune deck', card: old});
    expect(JSON.stringify(receipt)).not.toMatch(/Secret new identity|SECRET|999|777/);
  });

  it('does not disclose hidden-only changes, draws into an opposing hand or new hidden cards', () => {
    const before = createLessonState('the-chain').board;
    const secret = before.cards.find(card => card.owner === 'opponent' && card.zone === 'hand')!;
    secret.zone = 'deck'; secret.faceDown = true; secret.name = 'Private identity';
    const after = structuredClone(before), moved = after.cards.find(card => card.instanceId === secret.instanceId)!;
    moved.zone = 'hand'; moved.might = 99; moved.damage = 88; moved.ready = !secret.ready;
    after.cards.push({...moved, instanceId: 'extra-secret', zone: 'hidden'});
    expect(getTeachingChanges(before, after)).toEqual([]);
  });

  it('does not compare old private statistics when a card becomes visible', () => {
    const before = createLessonState('the-chain').board;
    const old = before.cards.find(card => card.owner === 'player' && card.type === 'unit')!;
    old.faceDown = true; old.might = 999;
    const after = structuredClone(before), shown = after.cards.find(card => card.instanceId === old.instanceId)!;
    shown.faceDown = false; shown.might = 3;
    expect(JSON.stringify(getTeachingChanges(before, after))).not.toContain('999');
  });

  it('labels new prepared positions instead of presenting a falling score as gameplay', () => {
    const before = createLessonState('group-movement').board, after = structuredClone(before);
    after.foundation = {lessonId: 'damage-and-might', variant: before.foundation!.variant};
    expect(getTeachingChanges(before, after)).toEqual([{key: 'position-reset', label: 'A separate example', from: 'Previous position', to: 'New teaching position'}]);
    const scoreReset = structuredClone(before);
    scoreReset.players.player.score = before.players.player.score - 1;
    expect(getTeachingChanges(before, scoreReset)[0].key).toBe('position-reset');
  });

  it('does not call a new turn a new position or award points for scoring-marker resets', () => {
    const before = createLessonState('holding').board, after = structuredClone(before);
    before.battlefields[0].scoredBy = ['player'];
    after.turn = before.turn + 1; after.battlefields[0].scoredBy = [];
    expect(getTeachingChanges(before, after)).toEqual([]);
  });
});

describe('coach guidance boundaries', () => {
  it('withholds the exact action picture until the learner asks for that level of practice help', () => {
    let state = createLessonState('practice-first-point');
    while (getTutorialStep(state)?.guidance !== 'practice' || getTutorialStep(state)?.expectedAction.type !== 'exhaust') {
      state = applyTutorialAction(state, getTutorialStep(state)!.expectedAction);
    }
    const lesson = LESSONS.find(item => item.id === state.lessonId)!;
    const render = (practiceHelpLevel: 0 | 1 | 2) => renderToStaticMarkup(<FloatingTutorialCoach lesson={lesson} state={state} step={getTutorialStep(state)} onContinue={() => undefined} onNext={() => undefined} lastLesson={false} practiceHelpLevel={practiceHelpLevel}/>);
    expect(render(0)).not.toContain('nph-step-picture');
    expect(render(1)).not.toContain('nph-step-picture');
    expect(render(2)).toContain('nph-step-picture');
  });

  it('leaves all current lesson positions and action records unchanged while producing visuals', () => {
    let checked = 0;
    for (const lesson of LESSONS) {
      let state = createLessonState(lesson.id);
      while (!state.completed) {
        const step = getTutorialStep(state)!;
        const saved = JSON.stringify(state);
        getStepTeachingVisual(state, step);
        getTeachingChanges(state.history.at(-1), state.board);
        expect(JSON.stringify(state)).toBe(saved);
        const next = applyTutorialAction(state, step.expectedAction);
        expect(next.actions.length).toBe(state.actions.length + 1);
        state = next; checked++;
      }
    }
    expect(checked).toBe(920);
  });
});
