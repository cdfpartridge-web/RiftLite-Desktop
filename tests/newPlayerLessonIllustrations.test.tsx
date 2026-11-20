import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LessonIllustration } from '../src/renderer/new-player/NewPlayerLessonIllustration';
import { LESSON_VISUALS } from '../src/renderer/new-player/newPlayerLessonVisuals';
import { createLessonState, getTutorialStep, LESSONS } from '../src/shared/newPlayerTutorial';

describe('lesson illustration teaching', () => {
  it('covers the full course with actual artwork without changing lesson state', () => {
    expect(Object.keys(LESSON_VISUALS).sort()).toEqual(LESSONS.map(lesson => lesson.id).sort());
    for (const lesson of LESSONS) {
      const state = createLessonState(lesson.id);
      const before = structuredClone(state);
      const html = renderToStaticMarkup(<LessonIllustration lessonId={lesson.id} board={state.board} step={getTutorialStep(state) ?? undefined}/>);
      expect(html).toContain('Replay lesson illustration');
      expect(html).not.toContain('src=""');
      expect(html).not.toContain('Lesson card');
      expect(state).toEqual(before);
    }
  });

  it('pairs a legend with its chosen champion instead of drawing the same card twice', () => {
    const state = createLessonState('table-setup');
    const html = renderToStaticMarkup(<LessonIllustration lessonId={state.lessonId} board={state.board}/>);
    expect(html).toContain('alt="Ahri, Nine-Tailed Fox"');
    expect(html).toContain('alt="Ahri, Inquisitive"');
  });

  it('explains the playable card cost, not the zero cost on its payment rune', () => {
    for (const [id, name, energy] of [['play-first-unit', 'Watchful Sentry', 2], ['power-and-champion', 'Ahri, Inquisitive', 3]] as const) {
      const state = createLessonState(id);
      const html = renderToStaticMarkup(<LessonIllustration lessonId={id} board={state.board}/>);
      expect(html).toContain(`alt="${name}"`);
      expect(html).toContain(`${energy} energy`);
      expect(html).not.toContain('0 energy');
    }
    const state = createLessonState('power-and-champion');
    expect(renderToStaticMarkup(<LessonIllustration lessonId={state.lessonId} board={state.board}/>)).toContain('1 Mind power');
  });

  it('shows the unit that Action changes as well as the spell causing it', () => {
    const state = createLessonState('keyword-timing');
    const step = LESSONS.find(lesson => lesson.id === state.lessonId)!.steps.find(step => step.id === 'keyword-action-intro')!;
    const html = renderToStaticMarkup(<LessonIllustration lessonId={state.lessonId} board={state.board} step={step}/>);
    expect(html).toContain('alt="Legion Rearguard"');
    expect(html).toContain('alt="Cleave"');
    expect(html).toContain('2 Might');
    expect(html).toContain('5 Might');
  });

  it('does not take an example name from the guide’s concealed hand', () => {
    const state = createLessonState('read-a-card');
    state.board.cards.filter(card => card.owner === 'opponent' && card.zone === 'hand').forEach(card => {card.name = 'Concealed guide identity'; card.cardId = 'not-a-real-card';});
    expect(renderToStaticMarkup(<LessonIllustration lessonId={state.lessonId} board={state.board}/>)).not.toContain('Concealed guide identity');
  });
});
