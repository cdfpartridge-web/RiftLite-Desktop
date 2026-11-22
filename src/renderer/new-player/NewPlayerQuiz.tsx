import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleHelp, Lightbulb, RotateCcw, Video } from "lucide-react";
import { answerQuizQuestion, isQuizQuestionLearned, learnedQuizQuestions, startQuizCheckIn, needsLearnedAttempt, NEW_PLAYER_QUIZ, NEW_PLAYER_QUIZ_KEY, quizCheckInQuestions, quizSummary, type NewPlayerQuizProgress, type NewPlayerQuizQuestion, type QuizLearningContext } from "../../shared/newPlayerQuiz";
import { NEW_PLAYER_VIDEOS } from "../../shared/newPlayerVideos";
import { resolveCardArtwork } from "../cardArtwork";
import "./NewPlayerQuiz.css";

interface NewPlayerQuizProps extends QuizLearningContext {
  progress: NewPlayerQuizProgress;
  onProgressChange: (progress: NewPlayerQuizProgress) => void;
  saveWarning: string;
  onReviewLesson: (id: string, stepId?: string) => void;
  onReviewTopic: (id: string) => void;
  onMoveOn: () => void;
  onOpenExternal: (url: string) => Promise<void>;
  onSaveWarning: (warning: string) => void;
  nextLabel?: string;
}

export function NewPlayerQuiz({ progress, completedLessonIds, readTopicIds, onProgressChange, saveWarning, onReviewLesson, onReviewTopic, onMoveOn, onOpenExternal, onSaveWarning, nextLabel = "Creator videos" }: NewPlayerQuizProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [retryId, setRetryId] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const answers = useRef<HTMLFieldSetElement>(null);
  const pendingFocus = useRef<"feedback" | "answers" | null>(null);
  const context = { completedLessonIds, readTopicIds };
  const scope = progress.scope ?? "learned";
  const learned = learnedQuizQuestions(context);
  const unseen = NEW_PLAYER_QUIZ.filter(q => !isQuizQuestionLearned(q, context));
  const questions = scope === "all" ? NEW_PLAYER_QUIZ : quizCheckInQuestions(progress, context);
  // Old v1 rounds recorded their attempts only in the lifetime answer history.
  const roundProgress = scope === "learned" && progress.checkInAnswers ? { ...progress, answers: progress.checkInAnswers } : progress;
  const summary = quizSummary(roundProgress, questions, context);
  const learnedSummary = quizSummary(progress, learned, context);
  const question = questions.find(q => q.id === progress.currentId) ?? questions[0];
  const index = question ? questions.indexOf(question) : -1;
  const answer = question ? roundProgress.answers[question.id] : undefined;
  const questionLearned = question ? isQuizQuestionLearned(question, context) : false;
  const checked = Boolean(answer) && retryId !== question?.id && !(questionLearned && question && needsLearnedAttempt(roundProgress, question.id));
  const revisits = summary.revisits.filter(q => isQuizQuestionLearned(q, context));
  const understood = questions.filter(q => isQuizQuestionLearned(q, context) && !needsLearnedAttempt(roundProgress, q.id) && roundProgress.answers[q.id]?.latest === q.correctId);
  const unseenAttempted = questions.filter(q => !isQuizQuestionLearned(q, context) && progress.answers[q.id]);
  const showIntro = progress.view === "intro" || !question;
  useEffect(() => { setSelected(null); heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "nearest" }); }, [question?.id, progress.view, scope]);
  useEffect(() => {
    const target = pendingFocus.current === "feedback" ? feedback.current
      : pendingFocus.current === "answers" ? answers.current?.querySelector("input") : null;
    pendingFocus.current = null;
    target?.focus();
  }, [checked, question?.id, progress.view]);
  function save(next: NewPlayerQuizProgress) {
    onProgressChange(next);
    try { localStorage.setItem(NEW_PLAYER_QUIZ_KEY, JSON.stringify(next)); onSaveWarning(""); }
    catch { onSaveWarning("You can carry on with these questions, but this device couldn’t save your answers."); }
  }
  function openQuestion(id: string, retry = false) {
    if (!questions.some(q => q.id === id)) return;
    if (retry && id === question?.id && progress.view === "questions") pendingFocus.current = "answers";
    setRetryId(retry ? id : null); setSelected(null);
    const checkIn = scope === "learned" ? {
      checkInIds: questions.map(q => q.id),
      checkInAnswers: progress.checkInAnswers ?? Object.fromEntries(questions.filter(q => progress.answers[q.id]).map(q => [q.id, progress.answers[q.id]]))
    } : {};
    save({ ...progress, ...checkIn, scope, currentId: id, view: "questions" });
  }
  function changeScope(next: "learned" | "all") {
    setRetryId(null); setSelected(null);
    const nextProgress = next === "learned" && !progress.checkInIds?.length ? startQuizCheckIn(progress, context) : progress;
    save({ ...nextProgress, scope: next, view: "intro" });
  }
  function nextCheckIn() {
    setRetryId(null); setSelected(null);
    save(startQuizCheckIn(progress, context));
  }
  function finish() { setRetryId(null); save({ ...progress, scope, view: "results" }); }
  function links(q: NewPlayerQuizQuestion) {
    const videos = NEW_PLAYER_VIDEOS.filter(video => video.lessonIds.includes(q.lessonId) || video.topicIds.includes(q.topicId));
    const learnedQuestion = isQuizQuestionLearned(q, context);
    return <div className="nph-quiz-review-links"><button type="button" className="nph-secondary" onClick={() => q.reviewTopicId ? onReviewTopic(q.reviewTopicId) : onReviewLesson(q.lessonId, q.reviewStepId)}><BookOpen size={16} />{!learnedQuestion ? "Learn this topic" : q.reviewTopicId ? "Revisit the explanation" : q.reviewStepId ? "Revisit this example" : q.board ? "Try it on the board" : "Revisit the lesson"}</button>{videos.map(video => <button type="button" key={video.id} className="nph-secondary" onClick={() => void onOpenExternal(video.url)}><Video size={16} /><span>{video.title}<small>{video.creator}</small></span></button>)}</div>;
  }

  return <section className="nph-quiz" aria-label="Knowledge check">
    {saveWarning ? <p className="nph-warning" role="alert">{saveWarning}</p> : null}
    <div className="nph-quiz-scope" aria-label="Choose your check-in"><button type="button" className="nph-secondary" aria-pressed={scope === "learned"} onClick={() => changeScope("learned")}>What I’ve learned so far</button><button type="button" className="nph-secondary" aria-pressed={scope === "all"} onClick={() => changeScope("all")}>Explore all {NEW_PLAYER_QUIZ.length} questions</button></div>
    {showIntro ? <div className="nph-quiz-intro">
      <div className="nph-quiz-icon"><CircleHelp size={34} /></div><span className="nph-eyebrow">KNOWLEDGE CHECK</span>
      <h2 ref={heading} tabIndex={-1}>{scope === "learned" ? "Fancy trying a few questions?" : "Which rule do you want to try?"}</h2>
      <p>{scope === "learned" ? "This round uses the lessons you’ve finished and the Basics you’ve marked as read, so you can try those rules while they’re fresh." : "Pick any question you like. If it’s from a lesson you haven’t reached, you’ll see a note and your first guess won’t count towards what you need to revisit."}</p>
      <div className="nph-quiz-promises"><span><Check size={17} />No pass mark</span><span><BookOpen size={17} />Revisit the example</span><span><RotateCcw size={17} />Come back or try again</span></div>
      <p className="nph-muted-copy">{scope === "learned" ? `${questions.length} ${questions.length === 1 ? "question" : "questions"} in this round · ${learned.length} available from your learning so far. You can try the remaining questions in another round.` : `${NEW_PLAYER_QUIZ.length} questions · ${unseen.length} ${unseen.length === 1 ? "covers a topic" : "cover topics"} you haven’t completed yet.`} Your answers stay saved on this device. You can carry on to videos and decks whenever you like.</p>
      {!questions.length && <p className="nph-quiz-unseen-note">Once you’ve played a lesson or marked a Basics topic as read, you’ll see questions about it here. If you’d like a look now, open the full quiz above.</p>}
      <div className="nph-actions">{question ? <button type="button" className="nph-primary" onClick={() => openQuestion(question.id)}>{summary.answered ? "Continue this check-in" : "Let’s give it a go"}<ArrowRight size={17} /></button> : <button type="button" className="nph-primary" onClick={() => onReviewTopic("legend-and-champion")}>Learn about legends and champions<ArrowRight size={17} /></button>}<button type="button" className="nph-secondary" onClick={onMoveOn}>Skip for now</button>{summary.answered > 0 ? <button type="button" className="nph-text-button" onClick={finish}>See my check-in so far</button> : null}</div>
    </div> : progress.view === "questions" ? <>
      <div className="nph-quiz-top"><div><span className="nph-eyebrow">YOUR QUESTIONS</span><p>{summary.answered} of {questions.length} answered in this {scope === "learned" ? "round" : "full check-in"} · no pass mark</p></div><button type="button" className="nph-secondary" onClick={finish}>Finish for now</button><button type="button" className="nph-text-button" onClick={onMoveOn}>{nextLabel}<ArrowRight size={15} /></button></div>
      <div className="nph-quiz-layout"><nav className="nph-quiz-map" aria-label="Quiz questions"><span>Pick any question</span><div>{questions.map((q, i) => <button type="button" key={q.id} title={`${q.topic}${isQuizQuestionLearned(q, context) ? "" : " · Not studied yet"}`} aria-label={`Question ${i + 1}: ${q.topic}${roundProgress.answers[q.id] ? ", answered" : ""}${isQuizQuestionLearned(q, context) ? "" : ", not studied yet"}`} aria-current={q.id === question.id ? "step" : undefined} data-answered={Boolean(roundProgress.answers[q.id])} data-unseen={!isQuizQuestionLearned(q, context)} onClick={() => openQuestion(q.id)}>{i + 1}{roundProgress.answers[q.id] ? <Check size={10} /> : null}</button>)}</div><p>You can come back to any question you skip, and a dashed outline means you haven’t studied that topic yet.</p></nav>
        <article className="nph-quiz-question" data-question-id={question.id}>
          <span className="nph-eyebrow">{String(index + 1).padStart(2, "0")} / {questions.length} · {question.topic}</span>
          {!questionLearned && <p className="nph-quiz-unseen-note">You haven’t reached this topic yet, so have a guess if you like. You can try it again after the lesson.</p>}
          {questionLearned && needsLearnedAttempt(progress, question.id) && <p className="nph-quiz-unseen-note">You had a go at this one before the lesson, so we’ve kept that guess and you can try it again now.</p>}
          <h2 ref={heading} tabIndex={-1}>{question.prompt}</h2>
          {question.board && <QuizBoard key={question.id} board={question.board} />}
          <fieldset ref={answers} disabled={checked}><legend className="nph-sr-only">Choose one answer</legend>{question.options.map((option, i) => <label key={option.id} data-selected={(checked ? answer?.latest : selected) === option.id} data-correct={checked && option.id === question.correctId} data-missed={checked && answer?.latest === option.id && option.id !== question.correctId}>
            <input type="radio" name={`quiz-${question.id}`} value={option.id} checked={(checked ? answer?.latest : selected) === option.id} onChange={() => setSelected(option.id)} /><b>{String.fromCharCode(65 + i)}</b><span>{option.text}</span>{checked && option.id === question.correctId ? <Check size={19} aria-label="Correct answer" /> : null}
          </label>)}</fieldset>
          {checked ? <div ref={feedback} className="nph-quiz-feedback" data-correct={answer?.latest === question.correctId} tabIndex={-1} role="region" aria-labelledby="quiz-answer-result" aria-describedby="quiz-answer-explanation"><div><Lightbulb size={21} /><strong id="quiz-answer-result">{answer?.latest === question.correctId ? "That’s it." : questionLearned ? "Worth another look." : "Here’s how that play works."}</strong></div><p id="quiz-answer-explanation">{question.explanation}</p>{links(question)}<button type="button" className="nph-text-button" onClick={() => openQuestion(question.id, true)}>Try this question again</button></div> : null}
          <div className="nph-quiz-question-footer"><button type="button" className="nph-text-button" disabled={index === 0} onClick={() => openQuestion(questions[index - 1].id)}><ArrowLeft size={15} />Previous</button><div className="nph-actions">{checked ? <button type="button" className="nph-primary" onClick={() => index + 1 < questions.length ? openQuestion(questions[index + 1].id) : finish()}>{index + 1 < questions.length ? "Next question" : "See what to revisit"}<ArrowRight size={17} /></button> : <><button type="button" className="nph-text-button" onClick={() => index + 1 < questions.length ? openQuestion(questions[index + 1].id) : finish()}>Skip this question</button><button type="button" className="nph-primary" disabled={selected === null} onClick={() => { if (selected === null) return; pendingFocus.current = "feedback"; save(answerQuizQuestion(progress, question.id, selected, context)); setRetryId(null); }}>Check my answer<ArrowRight size={17} /></button></>}</div></div>
        </article>
      </div>
    </> : <>
      <header className="nph-quiz-results-heading"><span className="nph-eyebrow">YOUR CHECK-IN</span><h2 ref={heading} tabIndex={-1}>{summary.answered ? "Which ones would you like another go at?" : "Come back to these whenever you like."}</h2><p>{summary.answered ? `You tried ${summary.answered} questions in this ${scope === "learned" ? "round" : "check-in"}. If a rule caught you out, you can jump back to the example or have another go here.` : "You can carry on with the lessons, videos or decks whenever you like, and pick this up again later."}</p><div className="nph-quiz-result-counts"><span><strong>{understood.length}</strong> Understood in this round</span><span><strong>{revisits.length}</strong> Worth revisiting</span><span><strong>{unseen.length}</strong> Questions to study later</span></div><div className="nph-actions"><button type="button" className="nph-primary" onClick={onMoveOn}>{nextLabel}<ArrowRight size={17} /></button>{summary.unanswered.length ? <button type="button" className="nph-secondary" onClick={() => openQuestion(summary.unanswered[0].id)}>Try this round’s unanswered questions ({summary.unanswered.length})</button> : null}<button type="button" className="nph-text-button" onClick={() => openQuestion(questions[0].id)}>Review this round</button></div></header>
      {revisits.length ? <div className="nph-quiz-gaps"><h3><Lightbulb size={21} />Worth a revisit</h3><p>These are the ones you missed on your first go after studying the topic. If you get one on a retry it stays here, so you can find the example again.</p>{revisits.map(q => <article key={q.id}><span className="nph-eyebrow">{q.topic}{roundProgress.answers[q.id].latest === q.correctId ? " · Correct on retry" : ""}</span><h4>{q.prompt}</h4><details><summary>Remind me of the rule</summary><p>{q.explanation}</p></details>{links(q)}<button type="button" className="nph-text-button" onClick={() => openQuestion(q.id, true)}>Try this one again<ArrowRight size={14} /></button></article>)}</div> : summary.answered > unseenAttempted.length ? <div className="nph-quiz-clear"><Check size={24} /><div><h3>You got these on your first go.</h3><p>If you’d still like to look at a particular example, you can go straight back to the lesson.</p></div></div> : null}
      {unseen.length > 0 && <details className="nph-quiz-unseen"><summary>{unseen.length} {unseen.length === 1 ? "question" : "questions"} from topics you haven’t studied yet</summary><p>These questions cover lessons or Basics explanations you haven’t completed. Any early guesses stay saved.</p><ul>{unseen.map(q => <li key={q.id}><span>{q.topic}{progress.answers[q.id] ? " · Tried ahead" : ""}</span>{links(q)}</li>)}</ul></details>}
      {summary.unanswered.length > 0 ? <p className="nph-quiz-unanswered">{summary.unanswered.length === 1 ? "1 question in this round hasn’t been answered. It isn’t counted as wrong." : `${summary.unanswered.length} questions in this round haven’t been answered. They aren’t counted as wrong.`}</p> : null}
      {learned.length > 0 && <div className="nph-quiz-fresh"><p>{learnedSummary.unanswered.length ? `${learnedSummary.unanswered.length} learned ${learnedSummary.unanswered.length === 1 ? "question is" : "questions are"} still available. Try another short round whenever you like.` : "You’ve tried every question from your completed topics. You can revisit them in another short round."} Your earlier answers stay saved.</p><button type="button" className="nph-secondary" onClick={nextCheckIn}><RotateCcw size={15} />{learnedSummary.unanswered.length ? "Next short check-in" : "Practise another round"}</button></div>}
    </>}
  </section>;
}

function QuizBoard({ board }: { board: NonNullable<NewPlayerQuizQuestion["board"]> }) {
  const [inspected, setInspected] = useState<{cardId:string;name:string} | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (inspected) dialog.current?.showModal(); else if (dialog.current?.open) dialog.current.close(); }, [inspected]);
  return <figure className="nph-quiz-board"><figcaption>{board.caption}</figcaption><div className="nph-quiz-zones">{board.zones.map(zone => <section key={zone.label} className="nph-quiz-zone"><h3>{zone.label}</h3><div className="nph-quiz-position-cards">{zone.cards.map(card => <div className="nph-quiz-position-card" key={card.cardId}><button type="button" data-ready={card.ready} onClick={() => setInspected(card)} aria-label={`Read ${card.name}`}><img src={resolveCardArtwork(card.cardId)} alt={card.name} loading="lazy" /></button><strong>{card.name}</strong>{card.might !== undefined && <span className="nph-quiz-might">{card.might} Might</span>}{card.ready !== undefined && <small>{card.ready ? "Ready · upright" : "Exhausted · sideways"}</small>}</div>)}</div>{zone.note && <p>{zone.note}</p>}{zone.cards.length === 0 && <div className="nph-quiz-empty-space" aria-hidden="true" />}</section>)}</div><p className="nph-quiz-board-note">Select a card for a closer look, then come back to the question when you’re ready.</p><dialog ref={dialog} className="nph-quiz-card-dialog" aria-label={inspected ? `Read ${inspected.name}` : "Read card"} onClose={() => setInspected(null)}><button type="button" className="nph-secondary" onClick={() => setInspected(null)} autoFocus>Back to the question</button>{inspected && <img src={resolveCardArtwork(inspected.cardId)} alt={inspected.name} />}</dialog></figure>;
}
