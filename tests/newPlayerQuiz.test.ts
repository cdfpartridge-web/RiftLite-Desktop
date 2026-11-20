import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewPlayerQuiz } from "../src/renderer/new-player/NewPlayerQuiz";
import { answerQuizQuestion, initialQuizProgress, isQuizQuestionLearned, learnedQuizQuestions, makeQuizCheckIn, NEW_PLAYER_QUIZ, parseQuizProgress, quizCheckInQuestions, quizSummary, startQuizCheckIn, type NewPlayerQuizProgress } from "../src/shared/newPlayerQuiz.js";
import { LESSONS } from "../src/shared/newPlayerTutorial.js";
import { NEW_PLAYER_BASICS } from "../src/shared/newPlayerCurriculum.js";
import { NEW_PLAYER_TEACHING_CARD_FACTS } from "../src/shared/newPlayerTeachingDecks.js";

describe("optional new player knowledge check", () => {
  it("has valid unique questions, answers and real review destinations", () => {
    expect(NEW_PLAYER_QUIZ.length).toBe(51);
    expect(new Set(NEW_PLAYER_QUIZ.map(q => q.id)).size).toBe(NEW_PLAYER_QUIZ.length);
    for (const q of NEW_PLAYER_QUIZ) {
      expect(q.options).toHaveLength(3);
      expect(new Set(q.options.map(o => o.id)).size).toBe(3);
      expect(q.options.filter(o => o.id === q.correctId)).toHaveLength(1);
      expect(LESSONS.some(l => l.id === q.lessonId), q.lessonId).toBe(true);
      expect(NEW_PLAYER_BASICS.some(t => t.id === q.topicId), q.topicId).toBe(true);
      expect(q.explanation.length).toBeGreaterThan(50);
      if (q.reviewStepId) expect(LESSONS.find(l => l.id === q.lessonId)!.steps.some(step => step.id === q.reviewStepId)).toBe(true);
      if (q.reviewTopicId) expect(NEW_PLAYER_BASICS.some(topic => topic.id === q.reviewTopicId)).toBe(true);
    }
  });
  it("keeps an incorrect first attempt visible after a successful retry", () => {
    const q = NEW_PLAYER_QUIZ[0], wrong = q.options.find(o => o.id !== q.correctId)!;
    const original = initialQuizProgress();
    const missed = answerQuizQuestion(original, q.id, wrong.id);
    const retried = answerQuizQuestion(missed, q.id, q.correctId);
    expect(original.answers).toEqual({});
    expect(missed.answers[q.id].latest).toBe(wrong.id);
    expect(retried.answers[q.id]).toEqual({ first: wrong.id, latest: q.correctId });
    expect(quizSummary(retried).revisits.map(q => q.id)).toEqual([q.id]);
    expect(quizSummary(retried).firstTime).toBe(0);
  });
  it("reviews the matching keyword after the course is regrouped", () => {
    for (const id of ["ganking", "unique", "legion", "empowered", "flow"]) {
      const question = NEW_PLAYER_QUIZ.find(q => q.id === id)!;
      const lesson = LESSONS.find(l => l.id === question.lessonId)!;
      expect(lesson.steps.some(step => step.keywordScenarioId === `keyword-${id}`), id).toBe(true);
    }
  });
  it("does not classify skipped questions as wrong", () => {
    const initial = { ...initialQuizProgress(), view: "results" as const };
    expect(quizSummary(initial)).toMatchObject({ answered: 0, firstTime: 0, revisits: [] });
    expect(quizSummary(initial).unanswered).toHaveLength(NEW_PLAYER_QUIZ.length);
    const q = NEW_PLAYER_QUIZ[3];
    const some = answerQuizQuestion(initial, q.id, q.correctId);
    expect(quizSummary(some)).toMatchObject({ answered: 1, firstTime: 1, revisits: [] });
    expect(quizSummary(some).unanswered).toHaveLength(NEW_PLAYER_QUIZ.length - 1);
  });
  it("round-trips partial results and current question, never trusting a saved score", () => {
    const q = NEW_PLAYER_QUIZ[6];
    const progress = answerQuizQuestion({ ...initialQuizProgress(), view: "questions", currentId: q.id }, q.id, q.correctId);
    expect(parseQuizProgress(JSON.stringify({ ...progress, score: 24, passed: true }))).toEqual(progress);
    expect(quizSummary(parseQuizProgress(JSON.stringify(progress))).firstTime).toBe(1);
  });
  it.each([null, "", "invalid", "[]", '{"version":2}', "x".repeat(50_001)])("rejects malformed or incompatible storage", raw => {
    expect(parseQuizProgress(raw)).toEqual(initialQuizProgress());
  });
  it("drops unknown questions and malformed choices without discarding valid answers", () => {
    const q = NEW_PLAYER_QUIZ[0], other = NEW_PLAYER_QUIZ[1];
    const parsed = parseQuizProgress(JSON.stringify({ version: 1, view: "hacked", currentId: "missing", answers: {
      [q.id]: { first: q.correctId, latest: q.correctId }, [other.id]: { first: "unknown", latest: other.correctId }, missing: { first: "0", latest: "0" }
    } }));
    expect(parsed.view).toBe("intro");
    expect(parsed.currentId).toBe(q.id);
    expect(Object.keys(parsed.answers)).toEqual([q.id]);
    expect(answerQuizQuestion(parsed, "unknown", "0")).toBe(parsed);
    expect(answerQuizQuestion(parsed, q.id, "unknown")).toBe(parsed);
  });
  it("can finish a fully incorrect check-in without a pass flag or threshold", () => {
    let progress = initialQuizProgress();
    for (const q of NEW_PLAYER_QUIZ) progress = answerQuizQuestion(progress, q.id, q.options.find(o => o.id !== q.correctId)!.id);
    progress.view = "results";
    const parsed = parseQuizProgress(JSON.stringify(progress));
    expect(parsed.view).toBe("results");
    expect(quizSummary(parsed)).toMatchObject({ answered: NEW_PLAYER_QUIZ.length, firstTime: 0, unanswered: [] });
    expect(quizSummary(parsed).revisits).toHaveLength(NEW_PLAYER_QUIZ.length);
    expect(parsed).not.toHaveProperty("passed");
  });
  it("preserves existing answers when new board decisions are added", () => {
    const old = {version:1 as const, view:"results" as const, currentId:"identity", answers:{identity:{first:"0",latest:"1"},"final-point":{first:"0",latest:"0"}}};
    expect(parseQuizProgress(JSON.stringify(old))).toEqual(old);
    expect(quizSummary(parseQuizProgress(JSON.stringify(old))).revisits.map(q => q.id)).toEqual(["identity"]);
    expect(quizSummary(parseQuizProgress(JSON.stringify(old))).unanswered).toHaveLength(NEW_PLAYER_QUIZ.length - 2);
  });
  it("keeps a completed 31-question check-in and treats the new questions as unanswered", () => {
    const previousIds = ["draw-or-play", "mulligan-plan", "predict-survivor", "reserve-a-response", "recover-a-point", "identity", "chosen-champion", "mulligan", "abcd", "second-player", "energy", "exhausted-power", "recycle-location", "unit-entry", "battlefield-play", "timing", "chain-order", "counter-effect", "counter-costs", "waiting-play-effect", "departed-target", "lethal-first", "simultaneous", "holding", "final-point", "hidden", "ganking", "unique", "legion", "empowered", "flow"];
    const saved = { version: 1 as const, view: "results" as const, currentId: "flow", answers: Object.fromEntries(previousIds.map(id => [id, { first: "0", latest: "1" }])) };
    const restored = parseQuizProgress(JSON.stringify(saved));
    expect(restored).toEqual(saved);
    const summary = quizSummary(restored);
    expect(summary.answered).toBe(31);
    expect(summary.unanswered.map(q => q.id)).toEqual(NEW_PLAYER_QUIZ.filter(q => !previousIds.includes(q.id)).map(q => q.id));
    expect(summary.unanswered).toHaveLength(20);
    expect(summary.revisits.every(q => previousIds.includes(q.id))).toBe(true);
    const next = summary.unanswered[0];
    const answered = answerQuizQuestion(restored, next.id, next.correctId);
    expect(Object.fromEntries(previousIds.map(id => [id, answered.answers[id]]))).toEqual(saved.answers);
    expect(parseQuizProgress(JSON.stringify(answered))).toEqual(answered);
  });
  it("uses real card identities in the applied board questions", () => {
    const applied = NEW_PLAYER_QUIZ.filter(q => q.board);
    expect(applied).toHaveLength(10);
    for (const q of applied) {
      expect(q.board!.zones.length).toBeGreaterThan(1);
      for (const card of q.board!.zones.flatMap(zone => zone.cards)) expect(NEW_PLAYER_TEACHING_CARD_FACTS[card.cardId]?.name).toBe(card.name);
    }
  });
});


describe("check-ins follow the learner’s completed topics", () => {
  const nothing = { completedLessonIds: [], readTopicIds: [] };
  const everything = { completedLessonIds: LESSONS.map(lesson => lesson.id), readTopicIds: NEW_PLAYER_BASICS.map(topic => topic.id) };
  it("does not silently quiz a fresh player on the whole course", () => {
    expect(learnedQuizQuestions(nothing)).toEqual([]);
    expect(makeQuizCheckIn(initialQuizProgress(), nothing)).toEqual([]);
    expect(quizCheckInQuestions(initialQuizProgress(), nothing)).toEqual([]);
    expect(learnedQuizQuestions(everything)).toHaveLength(51);
  });
  it("does not treat reading a broad Basics topic as completing its keyword scenarios", () => {
    const basics = { completedLessonIds: [], readTopicIds: NEW_PLAYER_BASICS.map(topic => topic.id) };
    const ids = learnedQuizQuestions(basics).map(q => q.id);
    expect(ids).toContain("identity");
    expect(ids).toContain("exhausted-power");
    expect(ids).toContain("empty-main-deck");
    for (const id of ["ganking", "flow", "unique", "empowered", "waiting-play-effect", "gear-after-bearer"]) expect(ids).not.toContain(id);
  });
  it("requires the FAQ explanation rather than its fallback board link", () => {
    const q = NEW_PLAYER_QUIZ.find(question => question.id === "empty-main-deck")!;
    expect(isQuizQuestionLearned(q, { completedLessonIds: ["first-or-second"], readTopicIds: [] })).toBe(false);
    expect(isQuizQuestionLearned(q, { completedLessonIds: [], readTopicIds: ["first-real-game"] })).toBe(true);
  });
  it("keeps advanced material out of a first-game check-in", () => {
    const context = { completedLessonIds: LESSONS.filter(lesson => lesson.path === "first-game").map(lesson => lesson.id), readTopicIds: [] };
    const questions = learnedQuizQuestions(context);
    expect(questions.length).toBeGreaterThan(10);
    expect(questions.every(question => context.completedLessonIds.includes(question.lessonId) && !question.reviewTopicId)).toBe(true);
    expect(questions.map(q => q.id)).not.toContain("flow");
  });
  it("saves a varied round and keeps its questions stable while answers change", () => {
    let progress = initialQuizProgress();
    const checkInIds = makeQuizCheckIn(progress, everything);
    expect(checkInIds).toHaveLength(10);
    expect(new Set(checkInIds).size).toBe(10);
    expect(new Set(checkInIds.map(id => NEW_PLAYER_QUIZ.find(q => q.id === id)!.topic)).size).toBe(10);
    progress = { ...progress, scope: "learned", checkInIds, currentId: checkInIds[3], view: "questions" };
    const q = NEW_PLAYER_QUIZ.find(question => question.id === checkInIds[0])!;
    progress = answerQuizQuestion(progress, q.id, q.correctId);
    const restored = parseQuizProgress(JSON.stringify(progress));
    expect(restored).toEqual(progress);
    expect(quizCheckInQuestions(restored, everything).map(q => q.id)).toEqual(checkInIds);
  });
  it("can reach all51 through short rounds without discarding earlier answers", () => {
    let progress = initialQuizProgress();
    let rounds = 0;
    while (quizSummary(progress).unanswered.length && rounds < 10) {
      const ids = makeQuizCheckIn(progress, everything);
      expect(ids.length).toBeLessThanOrEqual(10);
      expect(ids.every(id => !progress.answers[id])).toBe(true);
      for (const id of ids) {
        const q = NEW_PLAYER_QUIZ.find(question => question.id === id)!;
        progress = answerQuizQuestion(progress, q.id, q.correctId);
      }
      rounds++;
    }
    expect(rounds).toBe(6);
    expect(Object.keys(progress.answers)).toHaveLength(51);
    expect(makeQuizCheckIn(progress, everything)).toHaveLength(10);
  });
  it("retains full-quiz position and answers when switching scopes", () => {
    const question = NEW_PLAYER_QUIZ.find(q => q.id === "flow")!;
    const original = answerQuizQuestion(initialQuizProgress(), question.id, "2");
    const saved = { ...original, scope: "all" as const, currentId: question.id, view: "questions" as const, checkInIds: ["identity", "mulligan"] };
    expect(parseQuizProgress(JSON.stringify(saved))).toEqual(saved);
    const learned = learnedQuizQuestions({ completedLessonIds: ["table-setup"], readTopicIds: [] });
    expect(quizSummary(saved, learned).revisits).toEqual([]);
    expect(saved.answers.flow.first).toBe("2");
  });
  it("starts repeat rounds without feedback and restores only this round’s answers when resumed", () => {
    let history = initialQuizProgress();
    for (const q of NEW_PLAYER_QUIZ) history = answerQuizQuestion(history, q.id, q.correctId, everything);
    const repeat = startQuizCheckIn(history, everything);
    const [first, second] = quizCheckInQuestions(repeat, everything);
    const wrong = first.options.find(o => o.id !== first.correctId)!.id;
    const markup = (progress: NewPlayerQuizProgress) => renderToStaticMarkup(createElement(NewPlayerQuiz, {
      ...everything, progress, saveWarning: "", onProgressChange() {}, onReviewLesson() {}, onReviewTopic() {},
      onMoveOn() {}, onOpenExternal: async () => {}, onSaveWarning() {}
    }));
    expect(markup(repeat)).toContain("0 of 10 answered");
    expect(markup(repeat)).not.toContain('aria-label="Correct answer"');
    expect(markup(repeat)).not.toContain("<fieldset disabled");
    const tried = answerQuizQuestion(repeat, first.id, wrong, everything);
    expect(tried.answers[first.id]).toEqual({ first: first.correctId, latest: wrong });
    expect(tried.checkInAnswers?.[first.id]).toEqual({ first: wrong, latest: wrong });
    const resumed = parseQuizProgress(JSON.stringify(tried));
    expect(markup(resumed)).toContain('aria-label="Correct answer"');
    const skipped = { ...resumed, currentId: second.id };
    expect(markup(skipped)).toContain("1 of 10 answered");
    expect(markup(skipped)).not.toContain("<fieldset disabled");
    expect(markup({ ...skipped, view: "results" })).toContain("9 questions in this round haven’t been answered.");
    const full = { ...skipped, scope: "all" as const };
    const explored = answerQuizQuestion(full, second.id, second.correctId, everything);
    expect(explored.checkInAnswers).toEqual(resumed.checkInAnswers);
    expect(markup(explored)).toContain("51 of 51 answered");
    const retried = answerQuizQuestion(resumed, first.id, first.correctId, everything);
    expect(retried.checkInAnswers?.[first.id]).toEqual({ first: wrong, latest: first.correctId });
    expect(markup(startQuizCheckIn(retried, everything))).toContain("0 of 10 answered");
    expect(Object.keys(retried.answers)).toHaveLength(51);
  });
  it("filters stale stored round IDs without losing valid answers", () => {
    const saved = { ...initialQuizProgress(), scope: "all", checkInIds: ["identity", "identity", "missing", 42] };
    expect(parseQuizProgress(JSON.stringify(saved)).checkInIds).toEqual(["identity"]);
    expect(parseQuizProgress(JSON.stringify({ ...saved, scope: "unsafe" })).scope).toBeUndefined();
  });
});


describe("early quiz guesses", () => {
  it("does not turn a pre-lesson guess into a learned knowledge gap", () => {
    const q = NEW_PLAYER_QUIZ.find(question => question.id === "flow")!;
    const unseen = { completedLessonIds: [], readTopicIds: [] };
    const learned = { completedLessonIds: [q.lessonId], readTopicIds: [] };
    const wrong = q.options.find(option => option.id !== q.correctId)!.id;
    const before = answerQuizQuestion(initialQuizProgress(), q.id, wrong, unseen);
    expect(before.answers[q.id]).toEqual({ first: wrong, latest: wrong, firstWasUnseen: true });
    expect(quizSummary(before, [q], learned)).toMatchObject({ answered: 0, revisits: [], unanswered: [q] });
    expect(makeQuizCheckIn(before, learned)).toContain(q.id);
    const after = answerQuizQuestion(before, q.id, q.correctId, learned);
    expect(after.answers[q.id]).toEqual({ first: wrong, latest: q.correctId, firstWasUnseen: true, firstLearned: q.correctId });
    expect(quizSummary(after, [q], learned)).toMatchObject({ answered: 1, firstTime: 1, revisits: [] });
    expect(parseQuizProgress(JSON.stringify(after))).toEqual(after);
  });
});
