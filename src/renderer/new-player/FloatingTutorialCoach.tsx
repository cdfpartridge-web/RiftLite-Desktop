import React, { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Layers3, Lightbulb, MessageCircle, Move, Pause, Play } from "lucide-react";
import { getNewPlayerTeachingDeck } from "../../shared/newPlayerTeachingDecks";
import { NEW_PLAYER_TABLE_TERMS, newPlayerTermsForText } from "../../shared/newPlayerCurriculum";
import { getTutorialStepCount } from "../../shared/newPlayerTutorial";
import type { TutorialLesson, TutorialState, TutorialStep } from "../../shared/newPlayerTutorial";
import { resolveCardArtwork } from "../cardArtwork";
import { getLessonVisual } from "./newPlayerLessonVisuals";
import { getStepTeachingVisual, getTeachingChanges, isTeachingCardVisible } from "./newPlayerVisualTeaching";
import mainBack from "./assets/atlas-cardback-blue.png";
import runeBack from "./assets/atlas-cardback-white.png";
import "./FloatingTutorialCoach.css";
import "./NewPlayerCinematicTheme.css";
import "./NewPlayerCinematicClassroom.css";
import "./NewPlayerVisualTeaching.css";

export function FloatingTutorialCoach({ lesson, state, step, onContinue, continueLabel, exampleRange, onNext, lastLesson, nextLabel, nextDescription, onBack, canBack = false, isAuto = false, paused = false, onPause, onAdvance, isSettling = false, practiceHelp = false, practiceHelpLevel, manualAdvance = false, narrationPart, narrationNext, onPracticeHelp, onOpenExternal, children }: { lesson: TutorialLesson; state: TutorialState; step: TutorialStep | null; onContinue: () => void; continueLabel?: string; exampleRange?: { start: number; count: number }; onNext: () => void; lastLesson: boolean; nextLabel?: string; nextDescription?: string; onBack?: () => void; canBack?: boolean; isAuto?: boolean; paused?: boolean; onPause?: () => void; onAdvance?: () => void; isSettling?: boolean; practiceHelp?: boolean; practiceHelpLevel?: 0 | 1 | 2; manualAdvance?: boolean; narrationPart?: string; narrationNext?: string; onPracticeHelp?: () => void; onOpenExternal?: (url: string) => void; children?: React.ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const termsPanel = useRef<HTMLDetailsElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hint, setHint] = useState(false);
  const [term, setTerm] = useState<string | null>(null);
  const [allTerms, setAllTerms] = useState(false);
  const [wordsOpen, setWordsOpen] = useState(false);
  const practice = state.board.practice;
  const mission = step?.practiceGoal ?? lesson.practice?.goal;
  const helpLevel = practiceHelpLevel ?? (practiceHelp ? 2 : 0);
  const practiceHidden = step?.guidance === "practice" && helpLevel < 2 && !isAuto;
  const rulesActing = step?.actor === "rules";
  const automaticAdvanceLabel = narrationNext ?? (rulesActing ? "Next effect" : "Next move");
  const automaticTitle = rulesActing
    ? manualAdvance ? "YOUR PACE · RULES WAITING" : paused ? "GAME RULES PAUSED" : "GAME RULES"
    : manualAdvance ? "YOUR PACE · GUIDE WAITING" : paused ? "GUIDE PAUSED" : "GUIDE IS PLAYING";
  const automaticContext = isSettling ? rulesActing ? "Automatic effect complete" : "Guide’s move complete" : rulesActing ? "Automatic game effect" : state.board.turnPlayer === "opponent" ? "Opponent’s turn" : "Opponent’s response · your turn";
  const automaticDetail = isSettling ? paused ? "Step complete. Continue when you are ready." : "Look at what changed. Continue when you are ready."
    : manualAdvance ? `Choose ${automaticAdvanceLabel} when you are ready.`
    : paused ? `Choose ${automaticAdvanceLabel} to take one step, or resume.` : `Watch the table, or choose ${automaticAdvanceLabel}.`;
  const stepIndex = state.stepIndex - (exampleRange?.start ?? 0);
  const stepCount = exampleRange?.count ?? getTutorialStepCount(state);
  const contextualTerms = newPlayerTermsForText(practiceHidden ? `${mission ?? ""} ${helpLevel === 1 ? step?.practiceHint ?? "" : ""}` : `${step?.title ?? ""} ${step?.instruction ?? ""}`);
  const shownTerms = allTerms ? NEW_PLAYER_TABLE_TERMS : contextualTerms;
  const activeTerm = NEW_PLAYER_TABLE_TERMS.find(entry => entry.term === term);
  const action = step?.boardAction ?? step?.expectedAction;
  const source = action && "cardId" in action ? state.board.cards.find(card => card.instanceId === action.cardId) : undefined;
  const stepVisual = step && !practiceHidden && !isSettling ? getStepTeachingVisual(state, step) : null;
  const completedVisual = getLessonVisual(lesson.id);
  const completionCard = [completedVisual.cardId, completedVisual.secondCardId]
    .flatMap(id => state.board.cards.filter(card => card.cardId === id && isTeachingCardVisible(card)))
    .sort((a,b) => Number(a.type === 'rune') - Number(b.type === 'rune'))[0];

  const recentChanges = getTeachingChanges(state.history.at(-1), state.board);
  const gesture = action?.type === "setup" && action.destination ? "Drag the piece to its highlighted place on this table. Or select the piece, then click the place; Enter works for both."
    : action?.type === "activate" ? `Select ${source?.name ?? "the highlighted card"} and choose Activate ability${action.targetId ? ", then click its target" : ""}.${action.costCardId ? ` Pay by recycling ${state.board.cards.find(card => card.instanceId === action.costCardId)?.name ?? "the named card"} from your trash to your main deck.` : ""} Shortcut: Shift + click or Shift + Enter.`
    : action?.type === "choose-trigger" ? "Click the highlighted target to choose it for this ability. Choosing a target does not resolve the ability; players still have a chance to respond. Keyboard: Enter on the target."
    : action?.type === "spend-buff" ? "Click the unit with a Buff counter to spend that counter. This pays the trigger’s cost; the draw waits on the chain so players can respond. Keyboard: Enter on the unit."
    : action?.type === "ready" ? "Choose Awaken · ready all to turn your used cards upright. They are then ready for this turn."
    : action?.type === "check-beginning" ? "Choose Check Beginning. This checks beginning-of-turn abilities and whether you can score for holding a battlefield."
    : action?.type === "move-units" ? "Click each unit to select the group, then click the destination battlefield. Click a selected unit again to remove it. Keyboard: Tab and Enter."
    : action?.type === "move" ? "Drag the highlighted unit, or click it and then click the destination."
    : action?.type === "play" && action.destination?.startsWith("battlefield-") && ["hand", "champion"].includes(source?.zone ?? "") ? "Drag the card to the highlighted battlefield, or click the card and then click that battlefield."
    : action?.type === "play" ? `${source?.zone === "trash" ? "Open your trash, then click the highlighted card" : "Click the highlighted card"}${action.targetId ? ", then click its target" : ""}.`
    : action?.type === "predict" ? "Choose what to do with the inspected top card in your deck drawer. Looking at it alone does not change the deck."
    : action?.type === "remove-draft-copy" ? "Open your Main Deck, inspect the two copies, then choose Remove duplicate. Keyboard: Shift + F10 on the deck."
    : action?.type === "inspect" && source?.zone === "deck" ? "Open your Main Deck, then select the highlighted card when you have read it. Keyboard: Shift + F10 on the deck, then Enter on the card."
    : action?.type === "inspect" ? "Hover or focus to read without advancing. Click the highlighted card or space when ready; keyboard: Enter."
    : action?.type === "resolve" ? "Resolve means carry out the waiting effect. Click Resolve in the right-hand panel, or press S on the table."
    : action?.type === "exhaust" ? "Tap or click the highlighted ready rune to make 1 energy. With a keyboard, focus the rune and press Enter."
    : action?.type === "recycle" ? "Select the rune and choose Recycle to make matching power. You can also right-click it, or focus it and press Shift + F10."
    : action?.type === "channel" ? action.ready ? "Choose Channel ready runes, or Ctrl + click your Rune Deck." : "Choose Channel exhausted runes."
    : action?.type === "draw" ? "Click your Main Deck, or press D while the table is focused."
    : action?.type === "pass" ? `Click ${state.board.chain.length ? "Pass priority" : "Pass focus"} beside the active battlefield, or beside the chain when the action is outside a battlefield. You can also press W while the table is focused.`
    : action?.type === "score" ? `Click ${state.board.phase === "Beginning" ? "Hold + Score" : "Conquer"} beside the battlefield, or press Q while the table is focused.`
    : action?.type === "end-turn" ? "Use End Turn to let the scripted opponent act."
    : null;
  useLayoutEffect(() => {
    setHint(false); setTerm(null); setAllTerms(false); setWordsOpen(false); setCollapsed(false);
    panel.current?.querySelector('.nph-floating-content')?.scrollTo({top: 0});
  }, [state.lessonId, state.stepIndex, state.completed, isAuto, narrationPart]);
  useLayoutEffect(() => {
    if (isAuto && !state.completed) panel.current?.querySelector<HTMLElement>('.nph-narration-title')?.focus({preventScroll: true});
  }, [state.lessonId, state.stepIndex, isAuto, state.completed, narrationPart]);
  const openWords = () => {
    if (isAuto && !paused) onPause?.();
    setWordsOpen(true);
    requestAnimationFrame(() => termsPanel.current?.scrollIntoView({block: 'nearest'}));
  };
  return <>
    <aside ref={panel} className={`nph-floating-coach nph-cinematic-coach ${collapsed ? 'is-collapsed' : ''}`} aria-label="Lesson guide" data-automatic={isAuto} data-rules-event={rulesActing || undefined} data-paused={paused} data-practice-hidden={practiceHidden} onKeyDown={event => { if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey && canBack && onBack) { event.preventDefault(); event.stopPropagation(); onBack(); } }}>
      <div className="nph-floating-toolbar">
        <div className="nph-coach-identity"><span className="nph-coach-emblem" aria-hidden="true">{state.completed ? <CheckCircle2 size={18}/> : isAuto ? <Play size={16}/> : <Move size={17}/>}</span><div><small>{state.completed ? 'NICELY DONE' : rulesActing ? 'GAME RULES' : isAuto ? 'GUIDE’S TURN' : 'YOUR MOVE'}</small><strong>{state.completed ? 'Lesson complete' : `Step ${stepIndex + 1} of ${stepCount}`}</strong></div></div>
        {!collapsed && !state.completed && <button type="button" className="nph-words-toggle" onClick={openWords}>Words</button>}
        <button type="button" aria-label={collapsed ? 'Show lesson guide' : 'Minimise lesson guide'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <MessageCircle size={16}/> : <ChevronDown size={16}/>}</button>
      </div>
      {!collapsed ? <div className="nph-floating-content">
        <progress value={stepIndex} max={stepCount} aria-label={exampleRange ? "Example progress" : "Lesson progress"}/>
        {state.completed ? <div className="nph-floating-complete"><div className="nph-complete-picture">{completionCard && <img src={resolveCardArtwork(completionCard.cardId, completionCard.imageUrl)} alt={completionCard.name}/>}<CheckCircle2 size={30}/></div><h3>{lastLesson ? 'The course is yours to revisit' : 'That’s another skill practised'}</h3><p>{completedVisual.completion}</p><p className="nph-completion-next"><strong>WHAT COMES NEXT</strong>{nextDescription}</p><button className="nph-primary" type="button" onClick={onNext}>{nextLabel ?? (lastLesson ? 'Try the knowledge check' : 'Next lesson')}<ArrowRight size={16}/></button></div> : step ? <>
          {isAuto && <div className="nph-guide-status" role="status"><span aria-hidden="true"/>{automaticTitle}<em>{automaticContext}</em><small>{automaticDetail}</small></div>}
          {narrationPart && <span className="nph-narration-part">{narrationPart}</span>}
          <h3 className="nph-narration-title" tabIndex={-1}>{practiceHidden ? 'Your goal' : step.title}</h3>
          {stepVisual && <div className="nph-step-picture" data-kind={stepVisual.kind} aria-label="Picture this action">{stepVisual.card ? <img src={resolveCardArtwork(stepVisual.card.cardId, stepVisual.card.imageUrl)} alt={stepVisual.card.name}/> : stepVisual.back ? <img src={stepVisual.back === 'rune' ? runeBack : mainBack} alt={stepVisual.back === 'rune' ? 'Rune deck card back' : 'Main deck card back'}/> : <Layers3 size={25}/>}<div><span>{stepVisual.from}</span><ArrowRight aria-hidden="true"/><strong>{stepVisual.to}</strong></div></div>}
          {mission && !practiceHidden && <div className="nph-practice-mission"><strong>PUT IT INTO PRACTICE</strong>{isAuto && <span>{rulesActing ? 'This effect follows the game rules. Your next action will wait for you.' : 'The guide handles its own moves. Your next choice is yours to work out.'}</span>}</div>}
          {practice && <div className="nph-practice-context"><strong>{practice.mode === 'deck-check' ? 'Before the game · deck check' : `${practice.keyword} · ${practice.stage === 'after' ? 'what changed' : 'guided position'}`}</strong></div>}
          {!practice && lesson.champion !== 'Ahri' && state.stepIndex === 0 && <span className="nph-practice-swap">Separate practice position · {lesson.champion}</span>}
          <p className="nph-floating-instruction">{practiceHidden ? mission : step.instruction}</p>
          {practiceHidden && helpLevel === 1 && <aside className="nph-concept-hint" role="status"><strong>A clue to think about</strong><p>{step.practiceHint ?? 'Look at what is ready, what you can afford, and what helps the goal. You can ask for the exact move next.'}</p></aside>}
          {!isAuto && !practiceHidden && step.expectedAction.type !== 'continue' && step.expectedAction.type !== 'alternate-win-route' && <div className="nph-floating-move"><Move size={17}/><div><span>YOUR NEXT ACTION</span><strong>{step.label}</strong>{stepVisual && <small className="nph-board-gesture">{stepVisual.gesture}</small>}{gesture && (stepVisual ? <details className="nph-gesture-detail"><summary>How to do this on the board</summary><p>{gesture}</p></details> : <small className="nph-board-gesture">{gesture}</small>)}</div></div>}
          <div className="nph-floating-actions">
            {!isAuto && (step.expectedAction.type === 'continue' || step.expectedAction.type === 'alternate-win-route') && <button type="button" className="nph-primary" onClick={onContinue}>{step.expectedAction.type === 'alternate-win-route' ? 'Try the holding route' : continueLabel ?? 'Got it'}<ArrowRight size={15}/></button>}
            {!practiceHidden && <button type="button" className="nph-text-button" aria-expanded={hint} onClick={() => setHint(!hint)}><Lightbulb size={14}/>{hint ? 'Hide hint' : 'Need a hand?'}</button>}
          </div>
          {hint && !practiceHidden && <p className="nph-hint">{step.hint}</p>}
        </> : null}
        {state.feedback && <p className="nph-feedback" role="status">{state.feedback}</p>}
        {lesson.id === 'table-setup' && state.board.setup && state.board.setup.stage !== 'complete' && <aside className="nph-setup-format" aria-label="Match format"><strong>Best of three</strong><p>The first player to win two games wins a best-of-three (BO3) match. A best-of-one (BO1) match lasts one game. Atlas usually sets up the table for you. Placing the pieces yourself teaches you where they go at a real table.</p></aside>}
        {!state.completed && recentChanges.length > 0 && <details className="nph-step-changes" key={`${state.lessonId}-${state.actions.length}`}><summary>What just changed</summary><ul>{recentChanges.map(change => <li key={change.key}>{change.card && <img src={resolveCardArtwork(change.card.cardId, change.card.imageUrl)} alt=""/>}<span><strong>{change.label}</strong><em>{change.from}<ArrowRight size={12}/>{change.to}</em></span></li>)}</ul></details>}
        {!state.completed && <details ref={termsPanel} className="nph-context-terms" open={wordsOpen} onToggle={event => setWordsOpen(event.currentTarget.open)}><summary>Words at the table</summary><div>{shownTerms.map(entry => <button type="button" key={entry.term} aria-pressed={term === entry.term} onClick={() => { if (isAuto && !paused) onPause?.(); setTerm(term === entry.term ? null : entry.term); }}>{entry.term}</button>)}</div><button type="button" className="nph-text-button" aria-expanded={allTerms} onClick={() => setAllTerms(!allTerms)}>{allTerms ? 'Just words in this step' : 'All table words'}</button>{activeTerm && <article role="status"><h4>{activeTerm.term}</h4><p>{activeTerm.explanation}</p><small>{activeTerm.example}</small><button type="button" className="nph-text-button" onClick={() => setTerm(null)}>Close definition</button></article>}</details>}
        <details className="nph-lesson-context" key={lesson.id}><summary>{practice ? 'About this practice position' : 'About this lesson'}</summary>{practice?.note && <p>{practice.note}</p>}<p>{lesson.scenarioNote}</p><div className="nph-practice-decks">{(['player','opponent'] as const).map(side => { const deck = getNewPlayerTeachingDeck(state.board.players[side].teachingDeckId); return deck ? <section key={side}><strong>{side === 'player' ? 'Your deck' : 'Guide’s deck'} · {deck.title}</strong><span>{deck.kind === 'published' ? 'Published Piltover Archive list' : 'RiftLite legal teaching deck'}</span><p>{deck.notes}</p>{deck.kind === 'published' && deck.sourceUrl && onOpenExternal && <button type="button" className="nph-text-button" onClick={() => onOpenExternal(deck.sourceUrl!)}>View published list{deck.author ? ` · ${deck.author}` : ''}</button>}</section> : null; })}</div></details>
        {children}
      </div> : <p className="nph-collapsed-note">Your guide is minimised. Show it again whenever you need the explanation. Your place stays saved.</p>}
      <footer className="nph-floating-navigation">
        <button type="button" onClick={onBack} disabled={!canBack || !onBack} aria-label="Back one step"><ArrowLeft size={15}/>Back</button>
        {step?.guidance === 'practice' && !isAuto && onPracticeHelp && <button type="button" className="nph-practice-help" onClick={onPracticeHelp} disabled={helpLevel === 2}><Lightbulb size={14}/>{helpLevel === 2 ? 'Next move shown' : helpLevel === 1 ? 'Show the next move' : 'Give me a clue'}</button>}
        {isAuto && onAdvance && <button type="button" className="nph-guide-advance" onClick={onAdvance} title={paused ? 'Take one step and stay paused' : 'Continue without waiting for the timer'}>{narrationNext ?? (isSettling ? 'Continue' : automaticAdvanceLabel)}<ArrowRight size={14}/></button>}
        {onPause && (isAuto || paused) && <button type="button" onClick={onPause} aria-pressed={paused} className="nph-guide-pause">{paused ? <Play size={14}/> : <Pause size={14}/ >}{paused ? rulesActing ? 'Resume rules' : 'Resume guide' : rulesActing ? 'Pause rules' : 'Pause guide'}</button>}
      </footer>
    </aside>
    <div className="nph-sr-only" role="status" aria-live="polite" aria-atomic="true">{state.completed ? 'Lesson complete.' : step ? practiceHidden ? `Practice goal: ${mission}. Choose Give me a clue if you want help, then Show the next move for the answer.` : `Step ${stepIndex + 1}: ${step.title}. ${step.instruction}. ${isAuto ? `${automaticTitle}. ${automaticDetail}` : `Your move: ${step.label}`}` : ''}</div>
  </>;
}
