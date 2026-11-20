// Load the surface foundations before child components share the cinematic theme.
import "./NewPlayerHub.css";
import "./NewPlayerBasics.css";
import "./NewPlayerQuiz.css";
import "./NewPlayerCourseIntro.css";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Copy, ExternalLink, Flag, Layers3, LoaderCircle, Maximize2, Play, RotateCcw, Search, Settings2, Shield, Video } from "lucide-react";
import type { DeckImportChoice, DeckImportResult } from "../../shared/types";
import { LESSONS, applyTutorialAction, createLessonState, getTutorialLessonContext, getTutorialStep, resetLessonState, undoTutorialAction, type TutorialAction, type TutorialState, type TutorialStep } from "../../shared/newPlayerTutorial";
import { guideNarrationDelay, guideNarrationPages, guideMoveOutcome, scheduleGuideNarration, NEW_PLAYER_NARRATION_KEY, parseGuideNarrationMode, type GuideNarrationMode } from "../../shared/newPlayerNarration";
import { nextGuidedLesson, resumeLessonState, saveLessonProgress, type NewPlayerProgress } from "../../shared/newPlayerProgress";
import { courseSaveWarning, loadCourseProgress, saveCourseProgress, subscribeCourseProgress } from "./newPlayerDeviceProgress";
import { newPlayerMilestoneProgress } from "../../shared/newPlayerMilestones";
import { NEW_PLAYER_KEYWORD_SCENARIOS } from "../../shared/newPlayerKeywordScenarios";
import { NewPlayerDeckHandoff, useNewPlayerDeckReadiness } from "./NewPlayerDeckHandoff";
import { NEW_PLAYER_BASICS, NEW_PLAYER_GLOSSARY, nextUnreadBasicsTopic } from "../../shared/newPlayerCurriculum";
import { NEW_PLAYER_DECKS, newPlayerDeckAtlasText, getNewPlayerDeckReadiness, type NewPlayerDeck } from "../../shared/newPlayerDecks";
import { NEW_PLAYER_VIDEOS } from "../../shared/newPlayerVideos";
import { initialQuizProgress, NEW_PLAYER_QUIZ_KEY, parseQuizProgress, type NewPlayerQuizProgress } from "../../shared/newPlayerQuiz";
import { DeckImportDecision } from "../DeckImportDecision";
import { NewPlayerBasics } from "./NewPlayerBasics";
import { NewPlayerCourseIntro } from "./NewPlayerCourseIntro";
import { FloatingTutorialCoach } from "./FloatingTutorialCoach";
import { NewPlayerQuiz } from "./NewPlayerQuiz";
import { AtlasTutorialBoard } from "./AtlasTutorialBoard";
import { NewPlayerCinematicArt } from "./NewPlayerCinematicArt";
import { getLessonVisual } from "./newPlayerLessonVisuals";
import "./NewPlayerCinematicTheme.css";
import "./NewPlayerCinematicHub.css";

type HubSection = "overview" | "basics" | "lessons" | "quiz" | "keywords" | "videos" | "decks";
type GuideHold = { lessonId: string; actionCount: number; stepIndex: number; step: TutorialStep; pages: string[]; page: number };
const isAutomaticStep = (step: TutorialStep | null | undefined): step is TutorialStep => step?.actor === "guide" || step?.actor === "rules";
const SECTIONS: Array<{ id: HubSection; label: string; icon: typeof BookOpen }> = [
  { id: "overview", label: "Your path", icon: Flag }, { id: "basics", label: "The basics", icon: BookOpen },
  { id: "lessons", label: "Guided game", icon: Play }, { id: "quiz", label: "Knowledge check", icon: CircleHelp }, { id: "keywords", label: "Keywords", icon: Search },
  { id: "videos", label: "Creator videos", icon: Video }, { id: "decks", label: "Your deck & Atlas", icon: Layers3 }
];

export type NewPlayerHubProps = {
  setupComplete: boolean;
  initialSection?: HubSection;
  onOpenSetup: () => void;
  onOpenPlay: () => void;
  onOpenLibrary: () => void;
  onOpenExternal: (url: string) => Promise<void>;
  onCopyText: (text: string) => Promise<void>;
} & ({
  onImportDeck: (text: string, choice?: DeckImportChoice) => Promise<DeckImportResult>;
  onShowDesktopDeck?: never;
} | {
  onImportDeck?: never;
  onShowDesktopDeck: (deck: NewPlayerDeck) => void;
});

// Keep session-only answers when a blocked-storage learner visits another app page.
// A renderer restart intentionally starts from the last successful device save.
let sessionQuizProgress: NewPlayerQuizProgress | null = null;
let sessionQuizWarning = "";
function loadQuizProgress(): NewPlayerQuizProgress {
  if (sessionQuizProgress) return sessionQuizProgress;
  try { return parseQuizProgress(window.localStorage.getItem(NEW_PLAYER_QUIZ_KEY)); } catch { return initialQuizProgress(); }
}

let sessionNarrationMode: GuideNarrationMode | null = null;
let sessionNarrationWarning = "";
function loadNarrationMode(): GuideNarrationMode {
  if (sessionNarrationMode) return sessionNarrationMode;
  try { return parseGuideNarrationMode(window.localStorage.getItem(NEW_PLAYER_NARRATION_KEY)); } catch { return "automatic"; }
}
function ReadingPace({ value, onChange }: { value: GuideNarrationMode; onChange: (mode: GuideNarrationMode) => void }) {
  return <label className="nph-reading-pace"><span>Guide pace</span><select aria-label="Guide reading pace" value={value} onChange={event => onChange(parseGuideNarrationMode(event.currentTarget.value))}><option value="automatic">Automatic · 6 seconds</option><option value="reading">More reading time</option><option value="manual">I’ll advance each move</option></select></label>;
}

const compactLessonHeader = "(max-width: 760px), (max-width: 900px) and (max-height: 500px)";

function LessonOptions({ narrationMode, onPaceChange, reviewing, storageWarning, onFullscreen, onRestart }: {
  narrationMode: GuideNarrationMode;
  onPaceChange: (mode: GuideNarrationMode) => void;
  reviewing: boolean;
  storageWarning: string;
  onFullscreen?: () => void;
  onRestart: (trigger: HTMLElement) => void;
}) {
  const [compact, setCompact] = useState(() => window.matchMedia(compactLessonHeader).matches);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia(compactLessonHeader);
    const resize = () => setCompact(media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    if (!compact) return;
    function dismiss(event: PointerEvent) {
      const menu = disclosure.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [compact]);

  function closeOptions() {
    if (disclosure.current?.open) {
      disclosure.current.open = false;
      summary.current?.focus();
    }
  }

  const controls = <>
    <ReadingPace value={narrationMode} onChange={onPaceChange} />
    <span className="nph-play-saved" data-warning={Boolean(storageWarning)} title={reviewing ? "Review freely. Your saved lesson checkpoint stays as it was." : storageWarning || "Your place is saved on this device."}>
      <Shield size={13} />{reviewing ? "Review · saved progress unchanged" : storageWarning ? "Session only" : "Progress saved"}
    </span>
    {onFullscreen && <button type="button" className="nph-text-button" onClick={() => { closeOptions(); onFullscreen(); }}><Maximize2 size={15} /><span>Full screen</span></button>}
    <button type="button" className="nph-text-button" onClick={event => { const trigger = summary.current ?? event.currentTarget; closeOptions(); onRestart(trigger); }}><RotateCcw size={15} /><span>Restart</span></button>
  </>;
  if (!compact) return controls;
  return <details className="nph-lesson-options" ref={disclosure}
    onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
    onKeyDown={event => { if (event.key === "Escape" && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); closeOptions(); } }}>
    <summary aria-label="Lesson options" ref={summary}><Settings2 size={15} aria-hidden="true" />Options</summary>
    <div className="nph-lesson-options-panel">{controls}</div>
  </details>;
}

export function NewPlayerHub(props: NewPlayerHubProps) {
  const [progress, setProgress] = useState(loadCourseProgress);
  const [quizProgress, setQuizProgress] = useState(loadQuizProgress);
  const [section, setSection] = useState<HubSection>(() => props.initialSection ?? (
    progress.lastLessonId || NEW_PLAYER_BASICS.every(topic => progress.readTopicIds.includes(topic.id)) ? "overview" : "basics"
  ));
  const [tutorial, setTutorial] = useState<TutorialState | null>(null);
  const [courseIntroOpen, setCourseIntroOpen] = useState(false);
  const [practiceHelpState, setPracticeHelpState] = useState<{ key: string; level: 0 | 1 | 2 } | null>(null);
  const practiceStepKey = tutorial ? `${tutorial.lessonId}:${tutorial.stepIndex}` : null;
  const practiceHelpLevel = practiceStepKey && practiceHelpState?.key === practiceStepKey ? practiceHelpState.level : 0;
  const practiceHelp = practiceHelpLevel === 2;
  useEffect(() => { setPracticeHelpState(null); }, [tutorial?.lessonId, tutorial?.stepIndex]);
  const [narrationMode, setNarrationMode] = useState(loadNarrationMode);
  const narrationModeRef = useRef(narrationMode);
  const [paceWarning, setPaceWarning] = useState(() => sessionNarrationWarning);
  const [topicId, setTopicId] = useState(() => NEW_PLAYER_BASICS.find(topic => !progress.readTopicIds.includes(topic.id))?.id ?? NEW_PLAYER_BASICS[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [storageWarning, setStorageWarning] = useState(courseSaveWarning);
  const [quizStorageWarning, setQuizStorageWarning] = useState(() => sessionQuizWarning);
  const [notice, setNotice] = useState("");
  const [milestoneVisible, setMilestoneVisible] = useState(false);
  const [capabilityVisible, setCapabilityVisible] = useState<string | null>(null);
  const [lessonReturn, setLessonReturn] = useState<HubSection | null>(null);
  const reviewStart = useRef<TutorialState | null>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const glossaryOrigin = useRef<string | null>(null);
  const returnFocusSelector = useRef<string | null>(null);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const restartConfirmRef = useRef(false);
  const [guidePaused, setGuidePaused] = useState(false);
  const guidePausedRef = useRef(false);
  const [guideHold, setGuideHold] = useState<GuideHold | null>(null);
  const guideHoldRef = useRef<GuideHold | null>(null);
  const [readingPart, setReadingPart] = useState({ key: "", page: 0 });
  const readingPartRef = useRef(readingPart);
  function setGuidePart(key: string, page: number) { const next = { key, page }; readingPartRef.current = next; setReadingPart(next); }
  const guideKey = (state: TutorialState) => `${state.lessonId}:${state.stepIndex}:${state.actions.length}`;
  const cancelGuideRef = useRef<(() => void) | null>(null);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const pageVisibleRef = useRef(!document.hidden);
  const [quizReview, setQuizReview] = useState(false);
  const quizReviewRef = useRef(false);
  const [courseReview, setCourseReview] = useState(false);
  const courseReviewRef = useRef(false);
  const progressRef = useRef(progress);
  const tutorialRef = useRef(tutorial);
  const mounted = useRef(true);
  progressRef.current = progress;
  tutorialRef.current = tutorial;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function cancelGuide() { cancelGuideRef.current?.(); cancelGuideRef.current = null; }
  function changeNarrationMode(mode: GuideNarrationMode) {
    cancelGuide(); narrationModeRef.current = mode; sessionNarrationMode = mode; setNarrationMode(mode);
    try { window.localStorage.setItem(NEW_PLAYER_NARRATION_KEY, mode); sessionNarrationWarning = ""; setPaceWarning(""); }
    catch { sessionNarrationWarning = "Your guide pace is kept for this session, but could not be saved on this device."; setPaceWarning(sessionNarrationWarning); }
  }
  function pauseGuide(paused: boolean) { guidePausedRef.current = paused; setGuidePaused(paused); if (paused) cancelGuide(); }
  function resetPlayback(paused = false) { cancelGuide(); guideHoldRef.current = null; setGuideHold(null); setGuidePart("", 0); pauseGuide(paused); }
  function setRestartDialog(open: boolean) { restartConfirmRef.current = open; if (open) cancelGuide(); setRestartConfirm(open); }
  function rewindNarration() {
    const current = tutorialRef.current;
    if (restartConfirmRef.current || !current?.actions.length) return;
    const hold = guideHoldRef.current;
    if (hold && hold.page > 0) { cancelGuide(); pauseGuide(true); const previous = { ...hold, page: hold.page - 1 }; guideHoldRef.current = previous; setGuideHold(previous); return; }
    if (!hold && readingPartRef.current.key === guideKey(current) && readingPartRef.current.page > 0) { cancelGuide(); pauseGuide(true); setGuidePart(guideKey(current), readingPartRef.current.page - 1); return; }
    if (current.stepIndex <= (reviewStart.current?.stepIndex ?? 0)) return;
    resetPlayback(true);
    changeTutorial(undoTutorialAction(current));
  }
  useEffect(() => {
    const update = () => { const visible = !document.hidden; pageVisibleRef.current = visible; if (!visible) cancelGuide(); setPageVisible(visible); };
    document.addEventListener("visibilitychange", update);
    return () => { cancelGuide(); document.removeEventListener("visibilitychange", update); };
  }, []);

  function persist(next: NewPlayerProgress) {
    const previous = progressRef.current;
    progressRef.current = next;
    setProgress(next);
    saveCourseProgress(previous, next);
  }
  useEffect(() => subscribeCourseProgress((latest, warning) => {
    if (!mounted.current) return;
    progressRef.current = latest;
    setProgress(latest);
    setStorageWarning(warning);
    const current = tutorialRef.current;
    if (!current || quizReviewRef.current || courseReviewRef.current) return;
    const checkpoint = latest.lessons[current.lessonId];
    if (!checkpoint || JSON.stringify(current.actions) === JSON.stringify(checkpoint.actions)) return;
    resetPlayback(true);
    setRestartDialog(false);
    setCourseIntroOpen(false);
    const restored = resumeLessonState(latest, current.lessonId);
    tutorialRef.current = restored;
    setTutorial(restored);
    setNotice("Your place in this lesson changed in another tab. You’re at the saved move.");
  }), []);
  function changeQuizProgress(next: NewPlayerQuizProgress) { sessionQuizProgress = next; setQuizProgress(next); }
  function changeQuizWarning(message: string) { sessionQuizWarning = message; setQuizStorageWarning(message); }

  function openLesson(id: string) {
    resetPlayback();
    reviewStart.current = null;
    setMilestoneVisible(false); setCapabilityVisible(null); setLessonReturn(null);
    quizReviewRef.current = false; setQuizReview(false);
    const reviewing = progressRef.current.completedLessonIds.includes(id);
    courseReviewRef.current = reviewing; setCourseReview(reviewing);
    const next = reviewing ? createLessonState(id) : resumeLessonState(progressRef.current, id);
    setCourseIntroOpen(!reviewing && id === "table-setup" && next.actions.length === 0);
    tutorialRef.current = next;
    setTutorial(next); setSection("lessons"); setRestartDialog(false);
    if (!reviewing) persist(saveLessonProgress(progressRef.current, next));
  }

  function changeTutorial(next: TutorialState) {
    tutorialRef.current = next;
    setTutorial(next);
    if (!quizReviewRef.current && !courseReviewRef.current) persist(saveLessonProgress(progressRef.current, next));
  }

  function commitGuideMove(current: TutorialState, narratedStep: TutorialStep) {
    const next = applyTutorialAction(current, narratedStep.expectedAction);
    if (next.stepIndex === current.stepIndex && next.completed === current.completed) { pauseGuide(true); tutorialRef.current = next; setTutorial(next); return; }
    const hold: GuideHold = { lessonId: current.lessonId, actionCount: next.actions.length, stepIndex: current.stepIndex, step: narratedStep, pages: guideMoveOutcome(current.board, next.board), page: 0 };
    guideHoldRef.current = hold; setGuideHold(hold);
    changeTutorial(next);
  }

  function advanceGuide() {
    const current = tutorialRef.current;
    if (!mounted.current || !current || restartConfirmRef.current || !pageVisibleRef.current) return;
    cancelGuide();
    if (guideHoldRef.current) {
      const hold = guideHoldRef.current;
      if (hold.page + 1 < hold.pages.length) { const next = { ...hold, page: hold.page + 1 }; guideHoldRef.current = next; setGuideHold(next); }
      else { guideHoldRef.current = null; setGuideHold(null); setGuidePart("", 0); }
      return;
    }
    const step = getTutorialStep(current);
    if (isAutomaticStep(step)) {
      const pages = guideNarrationPages(step.instruction), key = guideKey(current);
      const page = readingPartRef.current.key === key ? readingPartRef.current.page : 0;
      if (page + 1 < pages.length) setGuidePart(key, page + 1);
      else commitGuideMove(current, step);
    }
    // Advancing a paused guide is one move, not a request to resume playback.
  }

  function act(action: TutorialAction) {
    const current = tutorialRef.current;
    if (!current || restartConfirmRef.current || guideHoldRef.current || isAutomaticStep(getTutorialStep(current))) return;
    const next = applyTutorialAction(current, action);
    if (lessonReturn && finishKeywordLabel && next.stepIndex > current.stepIndex) {
      navigate(lessonReturn);
      if (reviewKeyword) setNotice(`You finished the ${reviewKeyword.keyword} example.`);
      return;
    }
    // Rejected inputs keep the same checkpoint and never mutate the board.
    if (next.stepIndex !== current.stepIndex || next.completed !== current.completed) { pauseGuide(false); changeTutorial(next); }
    else { tutorialRef.current = next; setTutorial(next); }
  }

  function navigate(next: HubSection) {
    const leaving = tutorialRef.current;
    if (leaving) {
      if (next === "keywords" && glossaryOrigin.current) returnFocusSelector.current = `[data-keyword-example="${CSS.escape(glossaryOrigin.current)}"]`;
      else if (next === "lessons") returnFocusSelector.current = `[data-lesson-id="${CSS.escape(leaving.lessonId)}"]`;
      glossaryOrigin.current = null;
    }
    resetPlayback(); reviewStart.current = null; setLessonReturn(null); setCourseIntroOpen(false); setSection(next); setTutorial(null); tutorialRef.current = null; setNotice(""); quizReviewRef.current = false; setQuizReview(false); courseReviewRef.current = false; setCourseReview(false); }
  function reviewQuizTopic(id: string) {
    navigate("basics"); setTopicId(id);
    quizReviewRef.current = true; setQuizReview(true);
  }
  function readBasicsTopic(item: typeof NEW_PLAYER_BASICS[number]) {
    if (!progressRef.current.readTopicIds.includes(item.id)) persist({ ...progressRef.current, readTopicIds: [...progressRef.current.readTopicIds, item.id] });
    if (quizReviewRef.current) { navigate("quiz"); return; }
    const next = nextUnreadBasicsTopic(item.id, progressRef.current.readTopicIds);
    if (next) setTopicId(next.id); else navigate("lessons");
  }
  function reviewQuizLesson(id: string, stepId?: string) {
    resetPlayback(); setLessonReturn(null);
    setCourseIntroOpen(false);
    let next = createLessonState(id);
    if (stepId) {
      for (let attempts = 0; attempts < 200 && !next.completed && getTutorialStep(next)?.id !== stepId; attempts++) {
        const step = getTutorialStep(next); if (!step) break;
        const advanced = applyTutorialAction(next, step.expectedAction);
        if (advanced.actions.length === next.actions.length) break;
        next = advanced;
      }
      if (getTutorialStep(next)?.id !== stepId) next = createLessonState(id);
    }
    reviewStart.current = next;
    quizReviewRef.current = true; setQuizReview(true);
    courseReviewRef.current = false; setCourseReview(false);
    tutorialRef.current = next; setTutorial(next); setSection("lessons"); setRestartDialog(false);
  }
  function openKeywordScenario(id: string, stepId: string, returnSection: HubSection = "keywords") {
    if (!tutorialRef.current && returnSection === "keywords") glossaryOrigin.current = stepId;
    reviewQuizLesson(id, stepId);
    quizReviewRef.current = false; setQuizReview(false);
    courseReviewRef.current = true; setCourseReview(true); setLessonReturn(returnSection);
  }
  function finishLesson() {
    if (!tutorialRef.current?.completed || tutorialRef.current.lessonId !== activeLesson?.id) return;
    if (lessonReturn) { navigate(lessonReturn); return; }
    if (quizReviewRef.current) { navigate("quiz"); return; }
    if (courseReviewRef.current) { navigate("lessons"); return; }
    if (activeLesson?.id === firstGameLessons.at(-1)?.id) { navigate("lessons"); setMilestoneVisible(true); return; }
    if (earnedMilestone) { navigate("lessons"); setCapabilityVisible(earnedMilestone.id); return; }
    if (nextLesson) openLesson(nextLesson.id); else navigate("quiz");
  }
  async function openExternal(url: string) {
    try { await props.onOpenExternal(url); } catch { if (mounted.current) setNotice("That page could not be opened. Please try again."); }
  }
  const activeLesson = tutorial ? LESSONS.find((lesson) => lesson.id === tutorial.lessonId)! : null;
  const activeStep = tutorial ? getTutorialStep(tutorial) : null;
  const reviewScenarioId = lessonReturn && reviewStart.current ? getTutorialStep(reviewStart.current)?.keywordScenarioId : undefined;
  const reviewKeyword = reviewScenarioId ? NEW_PLAYER_KEYWORD_SCENARIOS.find(item => item.id === reviewScenarioId) : undefined;
  const exampleRange = reviewKeyword && reviewStart.current && activeLesson ? {
    start: reviewStart.current.stepIndex, count: activeLesson.steps.filter(step => step.keywordScenarioId === reviewKeyword.id).length
  } : undefined;
  const finishKeywordLabel = reviewKeyword && activeStep?.id === `${reviewKeyword.id}-outcome`
    ? lessonReturn === "keywords" ? "Back to keywords" : lessonReturn === "quiz" ? "Back to knowledge check" : "Back to lessons"
    : undefined;
  const readingPages = activeStep && isAutomaticStep(activeStep) ? guideNarrationPages(activeStep.instruction) : [];
  const readingPage = tutorial && readingPart.key === guideKey(tutorial) ? readingPart.page : 0;
  const narrationPart = guideHold ? `What changed · ${guideHold.page + 1} / ${guideHold.pages.length}` : readingPages.length ? `Before the move · ${readingPage + 1} / ${readingPages.length}` : undefined;
  const narrationNext = guideHold ? guideHold.page + 1 < guideHold.pages.length ? "Next result" : "Continue" : readingPage + 1 < readingPages.length ? "Next explanation" : undefined;
  const displayStep = guideHold ? { ...guideHold.step, instruction: guideHold.pages[guideHold.page] } : activeStep && readingPages.length ? { ...activeStep, instruction: readingPages[readingPage] } : activeStep;
  const displayCoachState = tutorial && guideHold ? { ...tutorial, stepIndex: guideHold.stepIndex, completed: false } : tutorial;
  const guideActing = Boolean(guideHold || isAutomaticStep(activeStep));
  // An introduction describes the next prepared keyword position, before the
  // learner starts it. Preview the pure model without saving or advancing it.
  const contextState = tutorial && activeStep?.keywordScenarioId && ["keyword-intro", "lesson-intro"].includes(activeStep.presentation ?? "") ? applyTutorialAction(tutorial, activeStep.expectedAction) : tutorial;
  const lessonContext = contextState ? getTutorialLessonContext(contextState) : null;
  const lessonIndex = activeLesson ? LESSONS.indexOf(activeLesson) : -1;
  const topic = NEW_PLAYER_BASICS.find((item) => item.id === topicId) ?? NEW_PLAYER_BASICS[0];
  const keywords = NEW_PLAYER_GLOSSARY.filter((item) => `${item.term} ${item.explanation} ${item.example}`.toLowerCase().includes(query.trim().toLowerCase()));
  const completeCount = progress.completedLessonIds.length;
  const basicsComplete = NEW_PLAYER_BASICS.every(item => progress.readTopicIds.includes(item.id));
  const firstGameLessons = LESSONS.filter(lesson => (lesson.path ?? "first-game") === "first-game");
  const firstGameDone = firstGameLessons.filter(lesson => progress.completedLessonIds.includes(lesson.id)).length;
  const firstGameComplete = firstGameDone === firstGameLessons.length;
  const nextLesson = nextGuidedLesson(progress, tutorial?.lessonId ?? progress.lastLessonId);
  const nextStep = nextLesson ? (progress.lessons[nextLesson.id]?.actions.length ?? 0) + 1 : 1;
  const hasGuidedProgress = Boolean(progress.lastLessonId || completeCount || Object.keys(progress.lessons).length);
  const showGuidedNext = basicsComplete || hasGuidedProgress;
  const nextTopic = NEW_PLAYER_BASICS.find(item => !progress.readTopicIds.includes(item.id)) ?? NEW_PLAYER_BASICS[0];
  const basicsLabel = progress.readTopicIds.length ? "Continue the basics" : "Start with the basics";
  const guidedLabel = !nextLesson ? "Choose a lesson to review"
    : nextStep > 1 ? "Resume your guided game" : hasGuidedProgress ? "Continue your guided game" : "Start your guided game";
  function openNextBasics() { setTopicId(nextTopic.id); navigate("basics"); }
  function openNextGuided() { if (nextLesson) openLesson(nextLesson.id); else navigate("lessons"); }
  const groups = [
    {id:"first-game", title:"Your first complete game", description:"Build your board, choose your opening hand, then play through to a winning point."},
    {id:"practice", title:"Make your own decisions", description:"Try new opening hands, choose how to spend resources, and recover after losing control of a battlefield."},
    {id:"keywords", title:"The complete keyword course", description:"Action and Reaction first, then every other official keyword alphabetically. Come back whenever you meet an unfamiliar card."}
  ] as const;
  const milestones = newPlayerMilestoneProgress(progress.completedLessonIds);
  const capability = milestones.find(item => item.id === capabilityVisible);
  const earnedMilestone = milestones.find(item => item.endLessonId === activeLesson?.id && item.complete);
  const reachedWinningPoint = activeLesson && activeLesson.id === firstGameLessons.at(-1)?.id;
  const reviewingLesson = courseReview || quizReview;
  const completionLabel = lessonReturn === "keywords" ? "Back to keywords"
    : lessonReturn === "quiz" || quizReview ? "Back to knowledge check"
    : reviewingLesson ? "Back to lessons"
    : reachedWinningPoint ? firstGameComplete ? "Finish your first-game path" : "Back to the first-game path"
    : earnedMilestone ? "See your milestone"
    : !nextLesson ? "Try the knowledge check" : nextStep > 1 ? "Resume next lesson" : "Next lesson";
  const completionDetail = reviewingLesson ? "Your saved place is waiting when you leave this review."
    : reachedWinningPoint ? "See your first-game progress and choose what to practise next."
    : earnedMilestone ? earnedMilestone.title
    : nextLesson ? `${nextLesson.title}${nextStep > 1 ? ` · resume at step ${nextStep}` : ""}`
    : "Try a short knowledge check to find anything you want to revisit.";
  const afterCheck = () => navigate(NEW_PLAYER_VIDEOS.length ? "videos" : "decks");

  useEffect(() => {
    cancelGuide();
    if (!tutorial || courseIntroOpen || guidePaused || !pageVisible || restartConfirm || narrationMode === "manual") return;
    if (guideHold) {
      const hold = guideHold;
      cancelGuideRef.current = scheduleGuideNarration(guideNarrationDelay(hold.pages[hold.page], narrationMode)!,
        () => mounted.current && !guidePausedRef.current && pageVisibleRef.current && !restartConfirmRef.current && guideHoldRef.current === hold && tutorialRef.current?.lessonId === hold.lessonId && tutorialRef.current.actions.length === hold.actionCount,
        advanceGuide);
    } else if (isAutomaticStep(activeStep)) {
      const lessonId = tutorial.lessonId, stepIndex = tutorial.stepIndex, actionCount = tutorial.actions.length, narratedStep = activeStep;
      const part = readingPartRef.current;
      cancelGuideRef.current = scheduleGuideNarration(guideNarrationDelay(readingPages[readingPage], narrationMode)!,
        () => mounted.current && narrationModeRef.current === narrationMode && !guidePausedRef.current && pageVisibleRef.current && !restartConfirmRef.current && !guideHoldRef.current && tutorialRef.current?.lessonId === lessonId && tutorialRef.current.stepIndex === stepIndex && tutorialRef.current.actions.length === actionCount && getTutorialStep(tutorialRef.current)?.id === narratedStep.id,
        () => { if (readingPartRef.current === part) advanceGuide(); });
    }
    return cancelGuide;
  }, [tutorial?.lessonId, tutorial?.stepIndex, tutorial?.actions.length, courseIntroOpen, guideHold, guidePaused, pageVisible, restartConfirm, narrationMode, readingPart]);


  const playing = Boolean(tutorial);
  useEffect(() => {
    if (playing || !returnFocusSelector.current) return;
    const target = hubRef.current?.querySelector<HTMLButtonElement>(returnFocusSelector.current)
      ?? hubRef.current?.querySelector<HTMLButtonElement>(".nph-nav [aria-current]");
    returnFocusSelector.current = null;
    target?.focus();
  }, [playing]);
  const lessonBackLabel = lessonReturn === "keywords" ? "Back to keywords" : lessonReturn === "quiz" || quizReview ? "Back to knowledge check" : "All lessons";
  const overlayRef = useRef<HTMLElement>(null);
  const restartButtonRef = useRef<HTMLElement | null>(null);
  useEffect(() => { if (playing && !courseIntroOpen) overlayRef.current?.querySelector<HTMLButtonElement>(".nph-leave-lesson")?.focus(); }, [playing, courseIntroOpen]);
  useEffect(() => { if (restartConfirm) return () => { restartButtonRef.current?.focus(); }; }, [restartConfirm]);
  useEffect(() => {
    if (!playing) return;
    const shell = document.querySelector<HTMLElement>(".app-shell");
    const wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    overlayRef.current?.querySelector<HTMLButtonElement>(".nph-leave-lesson")?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (!overlayRef.current) return;
      const dialog = overlayRef.current.querySelector<HTMLElement>('[role="alertdialog"]');
      if (event.key === "Escape" && dialog) { event.preventDefault(); setRestartDialog(false); return; }
      if (event.key !== "Tab") return;
      const scope = dialog ?? overlayRef.current;
      const controls = Array.from(scope.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')).filter(item => !item.closest('[inert]') && item.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", trapFocus);
    return () => { if (shell) shell.inert = wasInert; document.removeEventListener("keydown", trapFocus); };
  }, [playing]);

  return <><div ref={hubRef} className="new-player-hub" data-section={section} hidden={playing}>
    <nav className="nph-nav" aria-label="Learn Riftbound sections">
      {SECTIONS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => navigate(id)}><Icon size={16} /><span>{label}</span></button>)}
      <span className="nph-local"><Shield size={13} />{storageWarning || quizStorageWarning ? "Session progress only" : "Saved on this device"}</span>
    </nav>
    {storageWarning ? <p className="nph-warning" role="alert">{storageWarning}</p> : null}
    {notice ? <p className="nph-notice" role="status">{notice}</p> : null}
    {paceWarning ? <p className="nph-warning" role="status">{paceWarning}</p> : null}
    {progress.migrationNotice ? <aside className="nph-migration" role="status"><div><strong>Your guided course has been updated.</strong><p>{progress.migrationNotice}</p></div><button type="button" className="nph-secondary" onClick={() => persist({ ...progressRef.current, migrationNotice: null })}>Got it</button></aside> : null}

    {section === "overview" ? <>
      <section className="nph-hero">
        <NewPlayerCinematicArt cardId="OGN-255" caption="Ahri · your first guided game" className="nph-home-art" />
        <div className="nph-hero-copy"><span className="nph-eyebrow">YOUR FIRST GAME STARTS HERE</span>
          <h2>Learn the cards.<br />Make your first move.</h2>
          <p>Never played a card game? Start here. See what a game looks like, learn one useful idea at a time, and reach your first winning point. More practice and every keyword are here when you want them.</p>
          <div className="nph-actions"><button className="nph-primary" type="button" onClick={showGuidedNext ? openNextGuided : openNextBasics}><BookOpen size={17} />{showGuidedNext ? guidedLabel : basicsLabel}<ArrowRight size={17} /></button>
            <button className="nph-secondary" type="button" onClick={() => showGuidedNext ? basicsComplete ? navigate("basics") : openNextBasics() : navigate("lessons")}>{showGuidedNext ? basicsComplete ? "Revisit the basics" : basicsLabel : "Browse the guided lessons"}</button></div>
          <div className="nph-hero-meta"><span><Clock3 size={14} />{showGuidedNext ? nextLesson ? `${nextLesson.title} · ${nextStep > 1 ? `saved at step ${nextStep}` : `about ${nextLesson.minutes} minutes`}` : `All ${LESSONS.length} guided lessons completed` : `Next: ${nextTopic.title} · one idea at a time`}</span><span>No cards or League knowledge needed</span><span>No account needed</span></div>
          <ReadingPace value={narrationMode} onChange={changeNarrationMode} /><p className="nph-pace-explanation">Choose more reading time or advance the guide yourself. You can change this during a lesson.</p>
        </div>
        <div className="nph-journey" aria-label="Your learning progress"><span className="nph-eyebrow">ONE CHAPTER AT A TIME</span><strong>{firstGameDone}<small> / {firstGameLessons.length}</small></strong><span>first-game lessons completed</span><progress value={firstGameDone} max={firstGameLessons.length} aria-label="First-game lessons completed" />
          <ol><li data-done={NEW_PLAYER_BASICS.every(item => progress.readTopicIds.includes(item.id))}><BookOpen size={17} /><span>Understand the game<small>Cards, domains and your deck</small></span></li><li data-done={firstGameComplete}><Play size={17} /><span>Finish your first game<small>From the opening hand to point eight</small></span></li><li><Layers3 size={17} /><span>Find your first deck<small>Popular Piltover Archive lists</small></span></li></ol>
        </div>
      </section>
      <div className="nph-section-heading"><div><span className="nph-eyebrow">A LITTLE KNOWLEDGE. A LOT OF PRACTICE.</span><h3>Everything you need for game one.</h3></div></div>
      <div className="nph-path-cards">
        {[{id:"basics" as const,n:"01",title:"Meet Riftbound",body:"Find your legend, understand your runes, and get comfortable with the table.",icon:BookOpen},{id:"lessons" as const,n:"02",title:"Learn by playing",body:"Pay, move, respond and score on an interactive board, with help when you need it.",icon:Play},{id:"decks" as const,n:"03",title:"Bring a game plan",body:"Choose a popular deck, learn its opening moves, and save your own copy.",icon:Layers3}].map(({id,n,title,body,icon:Icon}) => <button key={id} type="button" onClick={() => navigate(id)}><span className="nph-path-number">{n}</span><Icon size={23} /><h3>{title}</h3><p>{body}</p><span className="nph-link">Explore <ArrowRight size={16} /></span></button>)}
      </div>
      {!props.setupComplete ? <aside className="nph-setup-reminder"><Settings2 size={22} /><div><strong>Your RiftLite setup can wait.</strong><p>When you’re ready to play, choose your player, deck and replay preferences.</p></div><button type="button" className="nph-secondary" onClick={props.onOpenSetup}>Set up RiftLite</button></aside> : null}
    </> : null}

    {section === "basics" && topic ? <NewPlayerBasics topicId={topic.id} readTopicIds={progress.readTopicIds} onTopic={setTopicId} onOpenExternal={openExternal} onRead={readBasicsTopic} returnToQuiz={quizReview}><CreatorGuides topicId={topic.id} onOpen={openExternal} /></NewPlayerBasics> : null}

    {section === "lessons" && !tutorial ? <>
      <div className="nph-guided-start">
      <header className="nph-page-heading"><span className="nph-eyebrow">LEARN AT YOUR PACE</span><h2>Your first game.<br />Then make it your own.</h2><p>Start with the first-game path. Decision practice and the full keyword course stay available throughout. Every successful move saves on this device.</p></header>
      {nextLesson && <section className="nph-lesson-resume"><NewPlayerCinematicArt cardId={getLessonVisual(nextLesson.id).cardId} caption={nextLesson.title.replace(/^\d+\.\s*/, "")} /><div className="nph-resume-copy"><span className="nph-eyebrow">{nextStep > 1 ? `SAVED AT STEP ${nextStep}` : "NEXT UNFINISHED LESSON"} · {nextLesson.chapter}</span><h3>{nextLesson.title}</h3><p>{nextLesson.description}</p><button type="button" className="nph-primary" onClick={() => openLesson(nextLesson.id)}>{nextStep > 1 ? "Resume this lesson" : hasGuidedProgress ? "Start this lesson" : "Start your first game"}<ArrowRight size={17} /></button><small><Clock3 size={13}/>{nextLesson.minutes} minutes · your progress stays saved</small></div></section>}
      {(milestoneVisible || firstGameComplete) && <section className="nph-first-game-milestone" aria-label="First game milestone"><Flag size={30} /><div><span className="nph-eyebrow">A GOOD PLACE TO TAKE A BREATHER</span><h3>{firstGameComplete ? "You’ve completed your first-game path." : "You’ve practised the winning point."}</h3><p>You can now try some new decisions, check what you remember, or choose a deck. The keyword course will be here whenever you need it.</p><div className="nph-actions"><button className="nph-secondary" onClick={() => navigate("quiz")}>Check what clicked</button><button className="nph-secondary" onClick={afterCheck}>{NEW_PLAYER_VIDEOS.length ? "Creator guides" : "Choose a deck"}</button></div></div></section>}
      </div>
      {capability && nextLesson && <aside className="nph-capability-earned" role="status"><Check size={24}/><div><strong>{capability.title}</strong><p>{capability.goal}</p><p>{capability.next} Your place is saved if you want to stop here.</p><button type="button" className="nph-primary" onClick={() => openLesson(nextLesson.id)}>Continue: {nextLesson.title.replace(/^\d+\.\s*/, "")}<ArrowRight size={16}/></button></div></aside>}
      <section className="nph-capabilities" aria-label="Your learning milestones">{milestones.map(item => <article key={item.id} data-complete={item.complete}><span>{item.complete ? "Practised" : `${item.completed} / ${item.lessons.length} lessons`}</span><h3>{item.title}</h3><p>{item.goal}</p><progress value={item.completed} max={item.lessons.length} aria-label={item.title}/>{item.nextLesson && <button type="button" className="nph-text-button" onClick={() => openLesson(item.nextLesson!.id)}>{item.completed || progress.lessons[item.nextLesson.id]?.actions.length ? "Continue this part" : "Start this part"}<ArrowRight size={14}/></button>}</article>)}</section>
      {groups.map(group => { const lessons = LESSONS.filter(lesson => (lesson.path ?? "first-game") === group.id); return <section key={group.id} className="nph-course-group" aria-label={group.title}><div className="nph-section-heading"><div><span className="nph-eyebrow">{lessons.filter(lesson => progress.completedLessonIds.includes(lesson.id)).length} / {lessons.length} completed</span><h3>{group.title}</h3><p>{group.description}</p></div></div><div className="nph-lesson-list">{lessons.map(lesson => { const complete=progress.completedLessonIds.includes(lesson.id); const started=Boolean(progress.lessons[lesson.id]?.actions.length); return <button type="button" key={lesson.id} data-lesson-id={lesson.id} onClick={() => openLesson(lesson.id)} data-complete={complete}><span className="nph-lesson-number">{complete ? <Check size={19} /> : String(LESSONS.indexOf(lesson)+1).padStart(2,"0")}</span><div><small>{lesson.chapter}</small><h3>{lesson.title}</h3><p>{lesson.description}</p></div><span className="nph-lesson-time">{lesson.minutes} min</span><span className="nph-lesson-cta">{complete ? "Review" : started ? "Resume" : "Play"}<ChevronRight size={17} /></span></button>; })}</div></section>; })}
    </> : null}


    {section === "lessons" ? <aside className="nph-quiz-course-link"><CircleHelp size={26} /><div><h3>Check what clicked, whenever you like.</h3><p>Try a few game situations and find anything worth revisiting. No pass mark, and nothing is locked behind it.</p></div><button type="button" className="nph-primary" onClick={() => navigate("quiz")}>Try the knowledge check<ArrowRight size={16} /></button></aside> : null}

    {section === "quiz" ? <NewPlayerQuiz completedLessonIds={progress.completedLessonIds} readTopicIds={progress.readTopicIds} progress={quizProgress} onProgressChange={changeQuizProgress} saveWarning={quizStorageWarning} onReviewLesson={reviewQuizLesson} onReviewTopic={reviewQuizTopic} onMoveOn={afterCheck} nextLabel={NEW_PLAYER_VIDEOS.length ? "Creator videos" : "Choose your deck"} onOpenExternal={openExternal} onSaveWarning={changeQuizWarning} /> : null}

    {section === "keywords" ? <>
      <header className="nph-page-heading"><span className="nph-eyebrow">KEEP THIS CLOSE</span><h2>Keywords and useful terms.</h2><p>All 28 current official keywords, plus useful game terms. Each official keyword has a scenario in the guided course. The full card text still matters.</p></header>
      <label className="nph-search"><Search size={18} /><input value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="Search keywords and game terms…" aria-label="Search keywords and game terms" /></label>
      <div className="nph-glossary">{keywords.map(keyword => { const scenario = NEW_PLAYER_KEYWORD_SCENARIOS.find(item => item.keyword === keyword.term); const exampleCard = scenario?.before.cards.find(card => card.keywords?.includes(keyword.term)) ?? scenario?.before.cards.find(card => card.owner === "player" && card.type !== "rune" && card.type !== "legend"); return <article key={keyword.term} data-has-art={Boolean(exampleCard)}>{exampleCard && <NewPlayerCinematicArt cardId={exampleCard.cardId} className="nph-keyword-art" loading="lazy" />}<h3>{keyword.term}</h3><p>{keyword.explanation}</p><small>{keyword.example}</small>{scenario && <button type="button" className="nph-text-button nph-keyword-try" data-keyword-example={`${scenario.id}-intro`} onClick={() => openKeywordScenario(scenario.groupId, `${scenario.id}-intro`)}>Try this on the board<ArrowRight size={14}/></button>}</article>; })}</div>{!keywords.length ? <p className="nph-empty">No terms match “{query}”. Try a shorter word.</p> : null}
    </> : null}

    {section === "videos" ? NEW_PLAYER_VIDEOS.length ? <><header className="nph-page-heading"><span className="nph-eyebrow">LEARN FROM THE COMMUNITY</span><h2>Another way to see it click.</h2><p>Selected creator guides to revisit alongside your practice.</p></header><CreatorGuides onOpen={openExternal} /><button type="button" className="nph-primary" onClick={() => navigate("decks")}>Next: your deck and Atlas<ArrowRight size={16} /></button></> : <section className="nph-video-empty"><Video size={42} /><span className="nph-eyebrow">LEARN FROM THE COMMUNITY</span><h2>Another way to see it click.</h2><p>Creator guides will sit alongside the topics they explain, from your first turn to the chain. The video collection is being curated.</p><div className="nph-actions"><button type="button" className="nph-primary" onClick={() => navigate("decks")}>Next: your deck and Atlas<ArrowRight size={16} /></button><button type="button" className="nph-secondary" onClick={() => navigate("lessons")}>Back to the guided game</button></div></section> : null}

    {section === "decks" ? <>
      <header className="nph-page-heading"><span className="nph-eyebrow">YOUR FIRST REAL GAME</span><h2>Choose your deck.<br />Take it to Atlas.</h2><p>Popular lists from Piltover Archive, with a short guide to get you started. Difficulty is our learning guide; popularity is not a guarantee of results.</p></header>
      <div className="nph-export-path" aria-label="From learning to your first real game"><span><BookOpen size={17} />Basics</span><ChevronRight size={15} /><span><Play size={17} />Guided game</span><ChevronRight size={15} /><span><Video size={17} />Creator guides</span><ChevronRight size={15} /><strong><Layers3 size={17} />Your deck & Atlas</strong></div>
      <div className="nph-deck-grid">{NEW_PLAYER_DECKS.filter(deck => String(deck.difficulty) !== "Advanced").map(deck => <StarterDeck key={deck.id} deck={deck} {...props} onOpenExternal={openExternal} />)}</div>
      {NEW_PLAYER_DECKS.some(deck => String(deck.difficulty) === "Advanced") ? <><div className="nph-section-heading"><span className="nph-eyebrow">MORE TO LEARN</span><h3>A next step when you’re comfortable.</h3><p className="nph-muted-copy">Popular competitive archetypes with more sequencing and matchup decisions. Start with an approachable list above if this is your first card game.</p></div><div className="nph-deck-grid">{NEW_PLAYER_DECKS.filter(deck => String(deck.difficulty) === "Advanced").map(deck => <StarterDeck key={deck.id} deck={deck} {...props} onOpenExternal={openExternal} />)}</div></> : null}
      <AtlasHandoff />
      <aside className="nph-ready"><Flag size={26} /><div><h3>Your next game is yours.</h3>
        <p>{props.onShowDesktopDeck ? "Choose Copy for Atlas on a deck above, then paste the list into Atlas’s deck importer. To record your first game, open Play in the RiftLite desktop app." : "Add a deck to RiftLite, copy its Atlas list, then paste it into Atlas’s deck importer. Setup helps you choose your replay preferences before you play."}</p>
      </div><div className="nph-actions">{!props.setupComplete ? <button type="button" className="nph-primary" onClick={props.onOpenSetup}>Finish RiftLite setup<ArrowRight size={16} /></button> : <button type="button" className="nph-primary" onClick={props.onOpenPlay}>{props.onShowDesktopDeck ? "Play with the desktop app" : "Open Atlas"}<ArrowRight size={16} /></button>}
        <button type="button" className="nph-secondary" onClick={props.onOpenLibrary}>{props.onShowDesktopDeck ? "About the desktop deck library" : "My deck library"}</button></div></aside>
    </> : null}
  </div>
    {tutorial && activeLesson ? createPortal(<section ref={overlayRef} className="new-player-hub nph-play-overlay" role="dialog" aria-modal="true" aria-label={`Guided game: ${activeLesson.title}`}>
      {courseIntroOpen ? <NewPlayerCourseIntro tutorial={tutorial} narrationMode={narrationMode} onNarrationMode={changeNarrationMode} paceWarning={paceWarning} onStart={() => { act({ type: "continue" }); setCourseIntroOpen(false); }} onBack={() => navigate("lessons")} /> : <>
      <header className="nph-play-topbar" inert={restartConfirm}>
        <button type="button" className="nph-text-button nph-leave-lesson" aria-label={lessonBackLabel} onClick={() => navigate(lessonReturn ?? (quizReview ? "quiz" : "lessons"))}>
          <ArrowLeft size={17} /><span className="nph-return-wide">{lessonBackLabel}</span><span className="nph-return-short" aria-hidden="true">Back</span>
        </button>
        <div className="nph-current-lesson"><span>LESSON {String(lessonIndex + 1).padStart(2, "0")} / {LESSONS.length}<b className="nph-compact-status">{quizReview || courseReview ? " · Review" : storageWarning ? " · Session only" : ""}</b></span><h2>{reviewKeyword ? `${reviewKeyword.keyword} · ${reviewKeyword.title}` : activeLesson.title}</h2></div>
        <LessonOptions
          narrationMode={narrationMode}
          onPaceChange={changeNarrationMode}
          reviewing={quizReview || courseReview}
          storageWarning={storageWarning}
          onFullscreen={document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function" ? () => {
            const layout = overlayRef.current?.querySelector<HTMLElement>(".nph-classroom-layout");
            if (!layout) return;
            layout.dataset.atbFullscreen = "true";
            void layout.requestFullscreen().catch(() => {
              delete layout.dataset.atbFullscreen;
              setNotice("Full screen could not be opened. You can keep playing here.");
            });
          } : undefined}
          onRestart={trigger => { restartButtonRef.current = trigger; setRestartDialog(true); }}
        />
      </header>
      {notice || paceWarning ? <p className="nph-play-notice" role="status">{notice || paceWarning}</p> : null}
      {lessonContext && <aside className="nph-position-banner" data-kind={lessonContext.kind}><strong>{lessonContext.title}</strong><span>{lessonContext.position}</span>{activeLesson.path === "keywords" && <label className="nph-keyword-jump">Review an example<select aria-label="Review a keyword in this group" value="" onChange={event => { const scenario = NEW_PLAYER_KEYWORD_SCENARIOS.find(item => item.id === event.currentTarget.value); if (scenario) openKeywordScenario(scenario.groupId, `${scenario.id}-intro`, lessonReturn ?? (quizReview ? "quiz" : "lessons")); }}><option value="">Choose a keyword…</option>{NEW_PLAYER_KEYWORD_SCENARIOS.filter(item => item.groupId === activeLesson.id).map(item => <option key={item.id} value={item.id}>{item.keyword}</option>)}</select></label>}</aside>}
      <div className="nph-classroom-layout">
        <div className="nph-board-and-guide" inert={restartConfirm}><AtlasTutorialBoard disabled={restartConfirm || guideActing} practiceHelp={practiceHelp} practiceHelpLevel={practiceHelpLevel} onOpenExternal={openExternal} state={tutorial} step={displayStep ?? undefined} onAction={act} onUndo={rewindNarration} onReadingChange={reading => { if (reading) pauseGuide(true); }} />
        {displayStep?.presentation !== "turn-start" && displayStep?.presentation !== "keyword-intro" && displayStep?.presentation !== "mulligan-intro" && displayStep?.presentation !== "lesson-intro" ? <FloatingTutorialCoach narrationPart={narrationPart} narrationNext={narrationNext} practiceHelp={practiceHelp} practiceHelpLevel={practiceHelpLevel} onPracticeHelp={() => practiceStepKey && setPracticeHelpState({key:practiceStepKey,level:practiceHelpLevel === 0 ? 1 : 2})} manualAdvance={narrationMode === "manual"} onOpenExternal={openExternal} lesson={activeLesson} state={displayCoachState!} step={displayStep} onContinue={() => act(activeStep?.expectedAction.type === "alternate-win-route" ? { type: "alternate-win-route" } : { type: "continue" })} continueLabel={finishKeywordLabel} exampleRange={exampleRange} onNext={finishLesson} onBack={rewindNarration} canBack={tutorial.stepIndex > (reviewStart.current?.stepIndex ?? 0) && !restartConfirm} isAuto={guideActing} isSettling={Boolean(guideHold)} onAdvance={advanceGuide} paused={guidePaused || !pageVisible || narrationMode === "manual"} onPause={narrationMode === "manual" ? undefined : () => pauseGuide(!guidePausedRef.current)} nextLabel={completionLabel} nextDescription={completionDetail} lastLesson={!reviewingLesson && !nextLesson}><CreatorGuides lessonId={activeLesson.id} onOpen={openExternal} /></FloatingTutorialCoach> : null}</div>
        {restartConfirm ? <div className="nph-restart-overlay"><div className="nph-restart-dialog" role="alertdialog" aria-label={reviewStart.current?.stepIndex ? "Restart this example" : "Restart this lesson"} aria-describedby="nph-restart-description"><h3>{reviewStart.current?.stepIndex ? "Back to the start of this example?" : "Back to the start of this lesson?"}</h3><p id="nph-restart-description">Your other lessons stay saved.</p><div className="nph-actions"><button type="button" className="nph-primary" onClick={() => { resetPlayback(); changeTutorial(reviewStart.current ?? resetLessonState(tutorial)); setRestartDialog(false); }}>{reviewStart.current?.stepIndex ? "Restart example" : "Restart lesson"}</button><button type="button" className="nph-secondary" autoFocus onClick={() => setRestartDialog(false)}>Keep playing</button></div></div></div> : null}
      </div>
    </> }</section>, document.body) : null}
  </>;
}

function CreatorGuides({ topicId, lessonId, onOpen }: { topicId?: string; lessonId?: string; onOpen: (url: string) => Promise<void> }) {
  const videos = NEW_PLAYER_VIDEOS.filter(video => topicId ? video.topicIds.includes(topicId) : lessonId ? video.lessonIds.includes(lessonId) : true);
  if (!videos.length) return null;
  return <section className="nph-creator-guides" aria-label="Related creator guides"><h3>Watch a creator explain it</h3>{videos.map(video => <button key={video.id} type="button" className="nph-secondary" onClick={() => void onOpen(video.url)}><Video size={18} /><span><strong>{video.title}</strong><small>{video.creator}</small></span><ExternalLink size={14} /></button>)}</section>;
}

function AtlasHandoff() {
  const [selected, setSelected] = useState(0);
  const steps = [
    { icon: Layers3, title: "Choose and save", caption: "Your list in RiftLite", text: "Pick a deck whose plan makes sense to you. Read its opening-hand and first-turn guide, then choose Add to RiftLite. This saves your own copy in your deck library.", example: "Start with a plan: play a unit, conquer a battlefield, and save resources to defend it until you can score for holding." },
    { icon: Copy, title: "Copy the whole list", caption: "Ready for Atlas", text: "Choose Copy for Atlas on that same deck. This copies its legend, champion, main deck, runes and battlefields in Atlas’s text format. Keep every heading and card count when you paste it.", example: "Copy for Atlas is a separate step from Add to RiftLite. You need the copied text in the next step." },
    { icon: ExternalLink, title: "Import and check", caption: "Your deck in Atlas", text: "Open Atlas and sign in if asked. In its deck area, use the text import option, paste the whole list and save the deck. Check its legend and chosen champion match the guide before selecting it for a game.", example: "If import reports a problem, read what it flags and check the pasted list is complete. The source list and its review date remain linked above." },
    { icon: Flag, title: "Start a learning game", caption: "Take your next turn", text: "Choose the saved deck when creating or joining a game. Agree to a two-player best-of-three match if you want to use the setup taught here. Keep your deck guide nearby and take time to read unfamiliar cards.", example: "You can tell your opponent: “This is one of my first games. I may need a moment to read the cards.”" }
  ];
  const current = steps[selected], Icon = current.icon;
  return <section className="nph-atlas-handoff" aria-label="Your first Atlas session"><div className="nph-section-heading"><div><span className="nph-eyebrow">FROM THIS BOARD TO YOUR FIRST GAME</span><h3>Take it one step at a time.</h3><p>The lessons provide the cards. For Atlas, save and select your own imported deck.</p></div></div><div className="nph-handoff-path" role="group" aria-label="First-session steps">{steps.map((item, index) => <button key={item.title} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}><span>{index + 1}</span><item.icon size={28} /><strong>{item.title}</strong>{index < steps.length - 1 && <ArrowRight className="nph-handoff-arrow" size={18} aria-hidden="true" />}</button>)}</div><div className="nph-handoff-detail"><div className="nph-handoff-illustration" aria-hidden="true"><div className="nph-handoff-card"><Layers3 size={42} /><span>YOUR DECK</span></div><ArrowRight size={28} /><div className="nph-handoff-destination"><Icon size={48} /><span>{current.caption}</span></div></div><div><h4>{current.title}</h4><p>{current.text}</p><p className="nph-handoff-example">{current.example}</p></div></div><details className="nph-live-game-differences"><summary>What changes when the guide is gone?</summary><div className="nph-live-checklist"><section><h4>Your opponent makes their own choices</h4><p>Our draws and opponent were prepared to teach a situation. A real game can go differently. Look at the new position before deciding what to do.</p></section><section><h4>Keep track of what is waiting</h4><p>Make costs, targets and responses clear. Check that both players have finished responding before resolving effects or moving on to damage and scoring.</p></section><section><h4>Check your controls</h4><p>The tutorial provides demonstrations, highlighted actions and Back. Its extra teaching controls do not mean a live game will make those choices or allow the same rewind. Use Atlas’s Help for its controls.</p></section><section><h4>A point lost is another decision</h4><p>Read what survived, count your resources and look at both battlefields. You can learn from a game even when your opponent wins it.</p></section></div></details></section>;
}

function StarterDeck({ deck, onImportDeck, onShowDesktopDeck, onCopyText, onOpenExternal }: NewPlayerHubProps & { deck: NewPlayerDeck }) {
  const readiness = useNewPlayerDeckReadiness(deck);
  const [expanded,setExpanded]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [manualList, setManualList] = useState("");
  const manualCopyField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (manualList) {
      manualCopyField.current?.focus();
      manualCopyField.current?.select();
    }
  }, [manualList]);
  const [duplicate,setDuplicate]=useState<Extract<DeckImportResult,{status:"duplicate"}>|null>(null);
  const busyRef=useRef(false), mounted=useRef(true);
  useEffect(() => {mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function add(choice?:DeckImportChoice) {
    if (!onImportDeck) return;
    const current = getNewPlayerDeckReadiness(deck); if (!current.canUseSnapshot) { setError(current.explanation); return; }
    if(busyRef.current)return; busyRef.current=true;setBusy(true);setError("");setMessage("");
    try {const result=await onImportDeck(deck.deckText,choice);if(!mounted.current)return;
      if(result.status==="duplicate")setDuplicate(result);else {setDuplicate(null);setMessage(`${result.deck.title} is saved in your deck library.`);}
    }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:"The deck could not be added. Try again.");}
    finally{busyRef.current=false;if(mounted.current)setBusy(false);}
  }
  async function copy() {
    const current = getNewPlayerDeckReadiness(deck);
    if (!current.canUseSnapshot) { setError(current.explanation); return; }
    const text = newPlayerDeckAtlasText(deck);
    setError("");
    setMessage("");
    try {
      await onCopyText(text);
      if (!mounted.current) return;
      setManualList("");
      setMessage("Copied. In Atlas, open your decks, choose the text import option and paste this whole list. Save it, then select it for your game. The first-session checklist below walks through the handoff.");
    } catch {
      if (mounted.current) setManualList(text);
    }
  }
  return <article className="nph-deck"><NewPlayerCinematicArt cardId={deck.cards.legend[0]?.registryPrintId ?? deck.cards.champion[0]?.registryPrintId ?? "OGN-255"} caption={deck.champion} className="nph-deck-art" loading="lazy" /><div className="nph-deck-heading"><span className="nph-eyebrow">{deck.domains.join(" / ")}</span><span className="nph-difficulty">{deck.difficulty}</span></div><h3>{deck.champion}</h3>{deck.id === "pa-ksante" && <span className="nph-first-deck-pick">A clear starting plan: defend, then attack</span>}<p className="nph-deck-title">{deck.title}</p><p>{deck.summary}</p>
    <div className="nph-deck-source"><button type="button" className="nph-text-button" onClick={()=>void onOpenExternal(deck.sourceUrl)}>Piltover Archive · {deck.author}<ExternalLink size={12}/></button><small>{deck.sourceEvidence.views.toLocaleString("en-GB")} views · {deck.sourceEvidence.likes.toLocaleString("en-GB")} likes · checked {deck.reviewedAt.slice(0,10)}</small></div>
    <NewPlayerDeckHandoff deck={deck} readiness={readiness} onOpenExternal={onOpenExternal}/>
    <button type="button" className="nph-guide-toggle" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>{expanded?"Close quick guide":"How this deck plays"}<ChevronRight size={16}/></button>
    {expanded?<div className="nph-deck-guide"><p className="nph-muted-copy">{deck.difficultyReason}</p>{[{title:"Your game plan",items:deck.gamePlan},{title:"Your opening hand",items:deck.mulligan},{title:"Your first turns",items:deck.firstTurns},{title:"Watch out for",items:deck.pitfalls}].map(({title,items})=><section key={title}><h4>{title}</h4><ul>{items.map((item,index)=><li key={index}>{item}</li>)}</ul></section>)}</div>:null}
    <div className="nph-deck-actions">
      {onImportDeck && <button type="button" className="nph-primary" disabled={busy || Boolean(duplicate) || !readiness.canUseSnapshot} onClick={() => void add()}>{busy ? <LoaderCircle size={15} className="nph-spin" /> : <Layers3 size={15} />}Add to RiftLite</button>}
      <button type="button" className={onShowDesktopDeck ? "nph-primary" : "nph-secondary"} disabled={!readiness.canUseSnapshot} onClick={() => void copy()}><Copy size={15} />Copy for Atlas</button>
      {onShowDesktopDeck && <button type="button" className="nph-secondary" disabled={!readiness.canUseSnapshot} onClick={() => onShowDesktopDeck(deck)}><Layers3 size={15} />How to save in the desktop app</button>}
    </div>
    {duplicate?<DeckImportDecision duplicate={duplicate} busy={busy} onChoose={choice=>void add(choice)} onCancel={()=>setDuplicate(null)}/>:null}
    {manualList && readiness.canUseSnapshot && <label className="nph-manual-copy">Automatic copying is unavailable. Copy this whole list, then paste it into Atlas’s text importer.
      <textarea aria-label={`Atlas decklist for ${deck.champion}`} ref={manualCopyField} readOnly rows={5} value={manualList} onFocus={event => event.currentTarget.select()} />
    </label>}
    {message?<p className="nph-success" role="status"><Check size={14}/>{message}</p>:null}{error?<p className="nph-error" role="alert">{error}</p>:null}
  </article>;
}



