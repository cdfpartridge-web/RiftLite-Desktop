import { applyTutorialAction, getTutorialLessonContext } from "../../shared/newPlayerTutorial";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, HelpCircle, Maximize2, Minimize2, MoreHorizontal, RotateCcw, Zap } from "lucide-react";
import type { TutorialAction, TutorialBattlefieldId, TutorialCard, TutorialSide, TutorialState, TutorialStep, TutorialZone } from "../../shared/newPlayerTutorial";
import { LESSONS, getTutorialActionBattlefield, getTutorialStep } from "../../shared/newPlayerTutorial";
import { getNewPlayerTeachingDeck, NEW_PLAYER_TEACHING_CARD_FACTS } from "../../shared/newPlayerTeachingDecks";
import { NEW_PLAYER_KEYWORD_SCENARIOS } from "../../shared/newPlayerKeywordScenarios";
import { resolveCardArtwork } from "../cardArtwork";
import { getTutorialPaymentTeaching, getTutorialScoringTeaching } from "./atlasBoardTeaching";
import { LessonIllustration } from "./NewPlayerLessonIllustration";
import mainCardBack from "./assets/atlas-cardback-blue.png";
import runeCardBack from "./assets/atlas-cardback-white.png";
import riftLiteLogo from "../../../resources/riftlite-taskbar-icon.png";
import "./AtlasTutorialBoard.css";

export interface AtlasTutorialBoardProps {
  state: TutorialState;
  step?: TutorialStep;
  onAction: (action: TutorialAction) => void;
  onUndo?: () => void;
  onOpenExternal?: (url: string) => void;
  /** Pause automatic narration while the learner explicitly enlarges a card. */
  onReadingChange?: (reading: boolean) => void;
  disabled?: boolean;
  practiceHelp?: boolean;
  practiceHelpLevel?: 0 | 1 | 2;
  /** Inspection-only reuse for the Basics board tour. Never dispatches actions. */
  mode?: "tutorial" | "explore";
}

type CardMenu = { cardId: string; left: number; top: number };
type SetupPiece = { key: string; name: string; image: string; landscape?: boolean; action: Extract<TutorialAction, { type: "setup" }> };
type PendingTarget = { type: "play" | "place" | "hide" | "activate"; cardId: string; destination?: TutorialZone; costCardId?: string };
type CardRect = { left: number; top: number; width: number; height: number };
type ReaderImage = { cardId: string; imageUrl: string; name: string; landscape: boolean };
type CardFlight = { id: string; cardId: string; image: string; from: CardRect; to: CardRect };
type EffectBadge = { key: string; kind: string; left: number; top: number; width: number; label: string; before?: string; after?: string; base?: number; current?: number; modifiers?: Array<{ label: string; amount: number }> };
type EffectArrow = { key: string; path: string };
type BoardSnapshot = { lessonId: string; scenarioId?: string; actionCount: number; cards: TutorialCard[]; rects: Map<string, CardRect>; piles: Map<string, CardRect> };
const ZONE_LABELS: Partial<Record<TutorialZone, string>> = { base: "Base", "battlefield-left": "Left battlefield", "battlefield-right": "Right battlefield", trash: "Trash", hand: "Hand" };

/** A local teaching table. All game mutations pass through the tutorial reducer. */
export function AtlasTutorialBoard({ state, step, onAction, onUndo, onOpenExternal, onReadingChange, disabled = false, practiceHelp = false, practiceHelpLevel, mode = "tutorial" }: AtlasTutorialBoardProps) {
  const root = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pileRef = useRef<HTMLDivElement>(null);
  const pileOpener = useRef<HTMLElement | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const previousBoard = useRef<BoardSnapshot | null>(null);
  const [setupSelection, setSetupSelection] = useState<SetupPiece | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [readCardId, setReadCardId] = useState<string | null>(null);
  const [enlargedReader, setEnlargedReader] = useState<ReaderImage | null>(null);
  const readerExpandButton = useRef<HTMLButtonElement>(null);
  const readerDialog = useRef<HTMLDialogElement>(null);
  const [menu, setMenu] = useState<CardMenu | null>(null);
  const [target, setTarget] = useState<PendingTarget | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [mulliganIds, setMulliganIds] = useState<string[]>([]);
  const pendingDemo = useRef<TutorialStep["combatDemonstration"]>(undefined);
  const pendingDemoActionCount = useRef<number | null>(null);
  const previousCombatStep = useRef({ lessonId: state.lessonId, actionCount: state.actions.length });
  const [animatedCombatDemo, setCombatDemo] = useState<{ lessonId: string; actionCount: number; data: NonNullable<TutorialStep["combatDemonstration"]>; animate: boolean } | null>(null);
  const [pile, setPile] = useState<{ side: TutorialSide; zone: "trash" | "deck" | "banishment" } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled && typeof HTMLElement.prototype.requestFullscreen === "function" && typeof document.exitFullscreen === "function";
  const [helpOpen, setHelpOpen] = useState(false);
  const [targetPath, setTargetPath] = useState("");
  const [flights, setFlights] = useState<CardFlight[]>([]);
  const [inspectorRect, setInspectorRect] = useState<CardRect | null>(null);
  const [effectBadges, setEffectBadges] = useState<EffectBadge[]>([]);
  const [effectArrows, setEffectArrows] = useState<EffectArrow[]>([]);
  const [cuePosition, setCuePosition] = useState<{ left: number; top: number } | null>(null);
  const board = state.board;
  const cardById = (id: string | null | undefined) => board.cards.find(card => card.instanceId === id);
  const menuCard = cardById(menu?.cardId);
  const isMulligan = step?.expectedAction.type === "mulligan";
  const exploration = mode === "explore";
  const previousStep = state.stepIndex > 0 ? getTutorialStep({ ...state, stepIndex: state.stepIndex - 1, completed: false }) : null;
  const savedDemoData = !exploration && board.combat && state.actions.length > 0 && previousStep?.combatDemonstration ? previousStep.combatDemonstration : undefined;
  const combatDemo = animatedCombatDemo ?? (savedDemoData ? { lessonId: state.lessonId, actionCount: state.actions.length, data: savedDemoData, animate: false } : null);
  const combatDamageDealt = Boolean(combatDemo && [...combatDemo.data.targetAssignments, ...(combatDemo.data.returnAssignments ?? [])].some(entry => {
    const card = cardById(entry.cardId);
    return card && (card.damage > 0 || card.zone === "trash");
  }));
  const expected = step?.boardAction ?? step?.expectedAction;
  const showDamage = !exploration && expected?.type === "demonstrate-combat";
  const turnStart = !exploration && step?.presentation === "turn-start";
  const keywordIntro = !exploration && step?.presentation === "keyword-intro";
  const mulliganIntro = !exploration && step?.presentation === "mulligan-intro";

  const lessonIntro = !exploration && step?.presentation === "lesson-intro";
  const automatic = !exploration && (step?.actor === "guide" || step?.actor === "rules");
  const practiceHidden = step?.guidance === "practice" && (practiceHelpLevel ?? (practiceHelp ? 2 : 0)) < 2 && !automatic && !lessonIntro;
  const paymentTeaching = useMemo(() => !exploration && !practiceHidden ? getTutorialPaymentTeaching(state, step) : null, [state, step, exploration, practiceHidden]);
  const scoringTeaching = useMemo(() => !exploration ? getTutorialScoringTeaching(state, practiceHidden ? undefined : step) : null, [state, step, exploration, practiceHidden]);
  const activeChain = board.chain.at(-1);
  const chainCard = cardById(activeChain?.id) ?? cardById(activeChain?.id.replace(/:trigger$/, ""));
  const chainBattlefield = board.battlefields.find(field => field.cardId === activeChain?.cardId);
  const requestedTarget = !practiceHidden && target && (expected?.type === "play" || expected?.type === "activate") ? cardById(expected.targetId) : undefined;
  const visibleCard = (card: TutorialCard | undefined) => card && !(card.owner === "opponent" && (card.faceDown || card.zone === "hand")) ? card : undefined;
  const readBattlefield = board.battlefields.find(field => field.id === (hoveredId ?? readCardId)) ?? board.setup?.battlefieldOptions.find(field => field.cardId === (hoveredId ?? readCardId));
  const previewCard = visibleCard(requestedTarget?.zone === "chain" ? requestedTarget : readBattlefield ? undefined : cardById(hoveredId) ?? cardById(readCardId) ?? cardById(selectedId) ?? chainCard ?? paymentTeaching?.card ?? (!chainBattlefield && !scoringTeaching && !practiceHidden ? board.cards.find(card => step?.focusIds.includes(card.instanceId) && visibleCard(card)) : undefined));
  const previewBattlefield = readBattlefield ?? (!previewCard ? chainBattlefield ?? scoringTeaching?.field : undefined);
  const readerImage: ReaderImage | null = previewCard ? { cardId: previewCard.cardId, imageUrl: previewCard.imageUrl, name: previewCard.name, landscape: false } : previewBattlefield ? { cardId: previewBattlefield.cardId, imageUrl: previewBattlefield.imageUrl, name: previewBattlefield.name, landscape: true } : null;
  const hoveredCard = cardById(hoveredId);
  const hoveredBattlefield = board.battlefields.find(field => field.id === hoveredId) ?? board.setup?.battlefieldOptions.find(field => field.cardId === hoveredId);
  const hoverPreview = hoveredCard && !(hoveredCard.owner === "opponent" && (hoveredCard.faceDown || hoveredCard.zone === "hand"))
    ? { cardId: hoveredCard.cardId, imageUrl: hoveredCard.imageUrl, name: hoveredCard.name, landscape: false }
    : hoveredBattlefield ? { cardId: hoveredBattlefield.cardId, imageUrl: hoveredBattlefield.imageUrl, name: hoveredBattlefield.name, landscape: true } : null;
  const showPaymentTeaching = paymentTeaching && !readCardId && !hoverPreview;
  const showScoringTeaching = scoringTeaching && !showPaymentTeaching && !readCardId && !hoverPreview;
  const canAct = !exploration && !disabled && !automatic && !state.completed;
  const groupMove = !exploration && expected?.type === "move-units" ? expected : null;
  const passLabel = board.chain.length ? "Pass priority" : "Pass focus";
  const battlefieldAction = canAct && (expected?.type === "pass" || expected?.type === "score") ? getTutorialActionBattlefield(state, step) : null;
  const chainPass = canAct && expected?.type === "pass" && !battlefieldAction;
  const emit = (action: TutorialAction) => { if (canAct) onAction(action); };
  const setupTable = !exploration && state.lessonId === "table-setup";
  const showScoringStatus = !exploration && !setupTable && board.practice?.mode !== "deck-check";
  const openingScreen = !exploration && (state.lessonId === "opening-hand" || state.lessonId === "mulligan-practice" && !step?.decision);
  const guidedMulliganTarget = state.lessonId === "opening-hand" && expected?.type === "mulligan" && expected.cardIds.length === 1 ? cardById(expected.cardIds[0]) : undefined;
  const guidedMulliganReady = !guidedMulliganTarget || mulliganIds.length === 1 && mulliganIds[0] === guidedMulliganTarget.instanceId;
  const mulliganButtonLabel = guidedMulliganTarget && !guidedMulliganReady ? `Select ${mulliganIds.length ? "only " : ""}${guidedMulliganTarget.name.split(",")[0]}` : mulliganIds.length ? `Replace ${mulliganIds.length} card${mulliganIds.length === 1 ? "" : "s"}` : "Keep hand";
  const guide = (() => {
    if (!canAct || !expected || practiceHidden) return null;

    if (expected.type === "choose") return { key: "decision", label: "Choose what you think" };
    if (lessonIntro) return { key: "lesson-intro", label: "Start when you are ready" };
    if (mulliganIntro) return { key: "mulligan-intro", label: "Read the rules, then look at your hand" };
    if (keywordIntro) return { key: "keyword-intro", label: "Start this example when you are ready" };
    const source = "cardId" in expected ? cardById(expected.cardId) : undefined;
    if (expected.type === "setup") {
      if (expected.destination) return setupSelection ? { key: `setup-zone:${expected.destination}`, label: "Drop here, or click this space" } : { key: `setup-piece:${expected.cardId ?? expected.item}`, label: "Drag this piece, or click to select it" };
      return { key: `setup:${expected.item}:${expected.choice ?? ""}`, label: step?.label ?? "Set up your table" };
    }
    if (source && ["deck", "trash", "banishment"].includes(source.zone) && (pile?.side !== source.owner || pile.zone !== source.zone)) return { key: source.zone, label: `Select to open ${source.zone}` };
    if (menu && (expected.type === "recycle" || expected.type === "activate") && menu.cardId === expected.cardId) {
      return { key: `menu:${expected.type}`, label: expected.type === "recycle" ? "Choose Recycle for power" : "Choose Activate ability" };
    }
    if (expected.type === "inspect" && expected.cardId.startsWith("player:")) return { key: `setup-zone:${expected.cardId.split(":")[1]}`, label: "Click this part of your table" };
    if (expected.type === "inspect") return { key: `card:${expected.cardId}`, label: source?.zone === "chain" ? "Inspect this spell on the chain" : "Click when you have finished reading" };
    if (expected.type === "choose-trigger") return { key: `card:${expected.targetId}`, label: "Click to choose this ability’s target" };
    if (expected.type === "spend-buff") return { key: `card:${expected.cardId}`, label: "Click to spend this unit’s Buff" };
    if (expected.type === "predict") return { key: `predict:${expected.choice}`, label: expected.choice === "recycle" ? "Choose to recycle this card to the bottom" : "Choose to keep this card on top" };
    if (expected.type === "remove-draft-copy") return { key: `remove-draft:${expected.cardId}`, label: "Remove the duplicate from this draft" };
    if (expected.type === "activate") return target?.cardId === expected.cardId && expected.targetId
      ? { key: `card:${expected.targetId}`, label: "Click this ability’s target" }
      : { key: `card:${expected.cardId}`, label: "Select card · choose Activate ability" };
    if (expected.type === "exhaust") return { key: `card:${expected.cardId}`, label: "Exhaust rune · make 1 energy" };
    if (expected.type === "recycle") return { key: `card:${expected.cardId}`, label: "Select rune · choose Recycle" };
    if (expected.type === "play" && target?.type === "place" && expected.destination) return { key: `zone:${expected.destination}`, label: "Click this battlefield to play here" };
    if (expected.type === "play") return target?.cardId === expected.cardId && expected.targetId
      ? { key: `card:${expected.targetId}`, label: "Click this target" }
      : { key: `card:${expected.cardId}`, label: expected.targetId ? "Click · choose a target" : "Click to play" };
    if (expected.type === "move-units") {
      const next = expected.cardIds.find(id => !selectedGroupIds.includes(id));
      return next ? { key: `card:${next}`, label: "Click to add this unit to your group" }
        : { key: `zone:${expected.destination}`, label: "Click this battlefield to move the group together" };
    }
    if (expected.type === "move" || expected.type === "hide") return selectedId === expected.cardId || draggingId === expected.cardId || target?.cardId === expected.cardId
      ? { key: `zone:${expected.type === "move" ? expected.destination : expected.battlefieldId}`, label: "Drop here, or click this area" }
      : { key: `card:${expected.cardId}`, label: expected.type === "hide" ? "Drag to hide, or click" : "Drag to move, or click" };
    if (expected.type === "mulligan") {
      if (guidedMulliganTarget && mulliganIds.includes(guidedMulliganTarget.instanceId) && !guidedMulliganReady) {
        return { key: `card:${mulliganIds.find(id => id !== guidedMulliganTarget.instanceId)}`, label: "Click again to keep this card" };
      }
      const next = expected.cardIds.find(id => !mulliganIds.includes(id));
      return next ? { key: `card:${next}`, label: "Click to replace" } : { key: "mulligan", label: "Confirm your selection" };
    }
    if (expected.type === "channel") return { key: "channel", label: expected.ready ? "Channel ready runes" : "Channel exhausted runes" };
    if (expected.type === "draw") return { key: "draw", label: "Draw 1 card · or click your main deck" };
    if (expected.type === "demonstrate-combat") return { key: "demonstrate-combat", label: "Watch the damage assignment" };
    if (expected.type === "continue") return turnStart ? { key: "turn-start", label: "Start with Awaken" } : null;
    if (expected.type === "alternate-win-route") return null;
    return { key: expected.type, label: step?.label ?? "Your move" };
  })();
  const autoFocus = (...ids: string[]) => automatic && ids.some(id => step?.focusIds.includes(id)) || undefined;
  const guideProps = (key: string) => ({ "data-guide-target": guide?.key === key ? "true" : undefined, "data-guide-label": guide?.key === key ? guide.label : undefined, "data-guide-action": guide?.key === key ? expected?.type : undefined });

  useLayoutEffect(() => {
    root.current?.dispatchEvent(new CustomEvent("riftlite-guide-target-change", { bubbles: true }));
    const element = root.current;
    if (!element || !guide) { setCuePosition(null); return; }
    const update = () => {
      const targetElement = element.querySelector<HTMLElement>('[data-guide-target="true"]');
      if (!targetElement) { setCuePosition(null); return; }
      const bounds = element.getBoundingClientRect(), rect = targetElement.getBoundingClientRect();
      setCuePosition({ left: Math.max(10, Math.min(bounds.width - 270, rect.left - bounds.left + rect.width / 2 - 130)), top: rect.top - bounds.top > 52 ? rect.top - bounds.top - 44 : rect.bottom - bounds.top + 12 });
    };
    const observer = new ResizeObserver(update); observer.observe(element); update();
    return () => observer.disconnect();
  }, [state.lessonId, state.stepIndex, guide?.key, guide?.label]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (!exploration) { setInspectorRect(null); return; }
    const container = element.closest<HTMLElement>(".nph-classroom-layout, .abe-frame") ?? element.parentElement ?? element;
    let frame = 0;
    const blockerSelector = ".nph-floating-coach, .abe-popup, .atb-guide-cue, .atb-target-prompt, .atb-battlefield-actions, .atb-group-move";
    const blockers = () => Array.from(container.querySelectorAll<HTMLElement>(blockerSelector)).filter(node => node.offsetWidth && node.offsetHeight);
    const update = () => {
      element.dispatchEvent(new CustomEvent("riftlite-guide-target-change", { bubbles: true, detail: { reason: "card-preview" } }));
      const card = hoveredId && Array.from(element.querySelectorAll<HTMLElement>("[data-hover-card-id]")).find(node => node.dataset.hoverCardId === hoveredId);
      if (!card || !hoverPreview || openingScreen || (!exploration && state.lessonId === "mulligan-practice") || keywordIntro || turnStart || lessonIntro || mulliganIntro) { setInspectorRect(null); return; }
      const bounds = element.getBoundingClientRect(), anchor = card.getBoundingClientRect();
      const inset = 10, aspect = hoverPreview.landscape ? 1039 / 744 : 744 / 1039;
      const minLeft = Math.max(inset, inset - bounds.left), minTop = Math.max(inset, inset - bounds.top);
      const maxRight = Math.min(bounds.width - inset, window.innerWidth - bounds.left - inset);
      const maxBottom = Math.min(bounds.height - inset, window.innerHeight - bounds.top - inset);
      const availableWidth = maxRight - minLeft, availableHeight = maxBottom - minTop;
      if (availableWidth <= 0 || availableHeight <= 0) { setInspectorRect(null); return; }
      const preferredWidth = Math.min(hoverPreview.landscape ? 460 : 360, Math.max(260, bounds.width * (hoverPreview.landscape ? .32 : .23)), availableWidth, availableHeight * .86 * aspect);
      const source = { left: anchor.left - bounds.left, top: anchor.top - bounds.top, width: anchor.width, height: anchor.height };
      const obstacles = blockers().map(node => { const rect = node.getBoundingClientRect(); return { left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height }; });
      const overlap = (a: CardRect, b: CardRect, pad = 0) => Math.max(0, Math.min(a.left + a.width, b.left + b.width + pad) - Math.max(a.left, b.left - pad)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height + pad) - Math.max(a.top, b.top - pad));
      let next: CardRect | undefined;
      // Move the preview around the existing reading boxes. Their positions are
      // never changed by hover, including an explicit manual narrator position.
      for (const scale of [1, .92, .84, .76, .68, .6]) {
        const width = preferredWidth * scale, height = width / aspect, gap = 14;
        const clampX = (x: number) => Math.max(minLeft, Math.min(maxRight - width, x));
        const clampY = (y: number) => Math.max(minTop, Math.min(maxBottom - height, y));
        const xs = [source.left + source.width + gap, source.left - width - gap, source.left + (source.width - width) / 2, minLeft, maxRight - width, ...obstacles.flatMap(rect => [rect.left - width - gap, rect.left + rect.width + gap])];
        const ys = [source.top + (source.height - height) / 2, source.top - height - gap, source.top + source.height + gap, minTop, maxBottom - height, ...obstacles.flatMap(rect => [rect.top - height - gap, rect.top + rect.height + gap])];
        const candidates = xs.flatMap(left => ys.map(top => ({ left: clampX(left), top: clampY(top), width, height })));
        const clear = candidates.filter(candidate => obstacles.every(rect => overlap(candidate, rect, 10) === 0));
        if (!clear.length) continue;
        const score = (candidate: CardRect) => overlap(candidate, source, 6) * 100 + Math.hypot(candidate.left + width / 2 - source.left - source.width / 2, candidate.top + height / 2 - source.top - source.height / 2);
        next = clear.sort((a, b) => score(a) - score(b))[0];
        break;
      }
      setInspectorRect(previous => JSON.stringify(previous) === JSON.stringify(next ?? null) ? previous : next ?? null);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule); observer.observe(element);
    const positions = new MutationObserver(schedule);
    const observeBlockers = () => blockers().forEach(node => { observer.observe(node); positions.observe(node, { attributes: true, attributeFilter: ["style", "class"] }); });
    const panels = new MutationObserver(records => { if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(blockerSelector) || node.querySelector(blockerSelector))))) { observeBlockers(); schedule(); } });
    panels.observe(container, { childList: true, subtree: true }); observeBlockers(); schedule();
    window.addEventListener("scroll", schedule, true); window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); positions.disconnect(); panels.disconnect(); window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); };
  }, [hoveredId, hoverPreview?.cardId, hoverPreview?.landscape, openingScreen, setupTable, keywordIntro, turnStart, lessonIntro, mulliganIntro, exploration, state.lessonId, state.stepIndex]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const measure = (node: Element): CardRect => { const rect = node.getBoundingClientRect(); return { left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height }; };
    const rects = new Map<string, CardRect>();
    element.querySelectorAll<HTMLElement>(".atb-card[data-card-id],.atb-setup-piece[data-card-id]").forEach(node => { if (node.offsetWidth && node.offsetHeight) rects.set(node.dataset.cardId!, measure(node)); });
    const piles = new Map<string, CardRect>();
    for (const side of ["player", "opponent"] as const) for (const pile of ["deck", "rune-deck", "trash", "banishment"] as const) {
      const node = element.querySelector(`[data-animation-pile="${side}:${pile}"],.atb-${pile}.atb-${side}`); if (node) piles.set(`${side}:${pile}`, measure(node));
    }
    const chainPreview = element.querySelector(".atb-preview img") ?? element.querySelector(".atb-chain");
    if (chainPreview) for (const side of ["player", "opponent"]) piles.set(`${side}:chain`, measure(chainPreview));
    const previous = previousBoard.current;
    const accepted = previous?.lessonId === state.lessonId && previous.scenarioId === board.keywordScenario?.id && state.actions.length > previous.actionCount && state.actions.at(-1)?.type !== "alternate-win-route";
    const nextFlights: CardFlight[] = [];
    if (accepted && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const card of board.cards) {
        const before = previous.cards.find(item => item.instanceId === card.instanceId);
        if (before?.zone === card.zone && before?.attachedTo === card.attachedTo) continue;
        const sourceZone = before?.zone ?? (card.zone === "hand" ? "deck" : card.zone === "runes" ? "rune-deck" : null);
        if (!sourceZone) continue;
        const from = previous.rects.get(card.instanceId) ?? previous.piles.get(`${card.owner}:${sourceZone}`);
        const to = rects.get(card.instanceId) ?? piles.get(`${card.owner}:${card.zone}`);
        if (!from || !to || from.width === 0 || to.width === 0) continue;
        const concealed = card.owner === "opponent" && (card.faceDown || card.zone === "hand" || card.zone === "deck" || card.zone === "rune-deck");
        nextFlights.push({ id: `${state.actions.length}:${card.instanceId}`, cardId: card.instanceId, image: concealed ? card.type === "rune" ? runeCardBack : mainCardBack : resolveCardArtwork(card.cardId, card.imageUrl), from, to });
      }
    }
    setFlights(nextFlights.slice(0, 10));
    previousBoard.current = { lessonId: state.lessonId, scenarioId: board.keywordScenario?.id, actionCount: state.actions.length, cards: board.cards, rects, piles };
  }, [state.lessonId, state.actions.length, board]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { previousBoard.current = null; setFlights([]); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setReadCardId(null);
    setEnlargedReader(null);
    setSelectedGroupIds([]);
    setSetupSelection(null); setSelectedId(null); setMenu(null); setTarget(null); setMulliganIds([]); setDraggingId(null); setPile(current => { const source = expected && "cardId" in expected ? cardById(expected.cardId) : undefined; return current && source?.owner === current.side && source.zone === current.zone ? current : null; });
    // A card moved by an accepted action can unmount before mouseleave fires.
    // Retain an actual hover/focus, but let the current chain replace a stale preview.
    setHoveredId(current => current && Array.from(root.current?.querySelectorAll<HTMLElement>("[data-card-id], [data-hover-card-id]") ?? []).some(element => (element.dataset.cardId === current || element.dataset.hoverCardId === current) && element.matches(":hover, :focus")) ? current : null);
  }, [state.lessonId, state.stepIndex]);
  useLayoutEffect(() => {
    if (enlargedReader && !readerDialog.current?.open) readerDialog.current?.showModal();
  }, [enlargedReader]);
  useEffect(() => { onReadingChange?.(Boolean(enlargedReader)); return () => onReadingChange?.(false); }, [Boolean(enlargedReader), onReadingChange]);

  function closeReader() {
    readerDialog.current?.close();
    setEnlargedReader(null);
    readerExpandButton.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    const previous = previousCombatStep.current;
    const acceptedGuideAssignment = previous.lessonId === state.lessonId && state.actions.length === previous.actionCount + 1 && state.actions.at(-1)?.type === "guide" && previousStep?.combatDemonstration && board.combat;
    if (pendingDemo.current && pendingDemoActionCount.current !== null && state.actions.length === pendingDemoActionCount.current + 1) {
      setCombatDemo({ lessonId: state.lessonId, actionCount: state.actions.length, data: pendingDemo.current, animate: true });
    } else if (acceptedGuideAssignment && previousStep?.combatDemonstration) {
      setCombatDemo({ lessonId: state.lessonId, actionCount: state.actions.length, data: previousStep.combatDemonstration, animate: true });
    }
    previousCombatStep.current = { lessonId: state.lessonId, actionCount: state.actions.length };
    pendingDemo.current = undefined;
    pendingDemoActionCount.current = null;
    setCombatDemo(current => current && current.lessonId === state.lessonId && current.actionCount === state.actions.length && board.combat ? current : null);
  }, [state.lessonId, state.actions.length, board.combat]);
  useEffect(() => { setSelectedId(null); setHoveredId(null); setReadCardId(null); setPile(null); }, [state.lessonId]);
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const followLatest = () => { log.scrollTop = log.scrollHeight; };
    const observer = new ResizeObserver(followLatest);
    observer.observe(log); followLatest();
    return () => observer.disconnect();
  }, [board.log]);
  useEffect(() => {
    const update = () => {
      setFullscreen(Boolean(root.current && document.fullscreenElement?.contains(root.current)));
      document.querySelectorAll<HTMLElement>("[data-atb-fullscreen]").forEach(element => {
        if (element !== document.fullscreenElement) delete element.dataset.atbFullscreen;
      });
    };
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => {
    if (pile && document.activeElement instanceof HTMLElement) pileOpener.current = document.activeElement;
  }, [pile]);
  useEffect(() => {
    const panel = menu ? menuRef.current : pile ? pileRef.current : null;
    if (!panel) return;
    const next = panel.querySelector<HTMLButtonElement>('button[data-guide-target="true"]:not(:disabled)')
      ?? panel.querySelector<HTMLButtonElement>("button:not(:disabled)");
    next?.focus();
  }, [menu, pile, guide?.key]);
  useEffect(() => {
    const element = root.current;
    const targetIds = activeChain?.targetIds ?? (activeChain?.targetId ? [activeChain.targetId] : []);
    if (!element || !targetIds.length || previewCard?.instanceId !== chainCard?.instanceId) { setTargetPath(""); return; }
    const update = () => {
      const table = element.getBoundingClientRect();
      const source = element.querySelector<HTMLElement>(".atb-preview img")?.getBoundingClientRect();
      if (!source || !table.width || !table.height) { setTargetPath(""); return; }
      const x1 = (source.left + source.width / 2 - table.left) / table.width * 1800;
      const y1 = (source.top + source.height * .4 - table.top) / table.height * 1000;
      const cards = Array.from(element.querySelectorAll<HTMLElement>(".atb-card[data-card-id],.atb-setup-piece[data-card-id]"));
      setTargetPath(targetIds.flatMap(id => {
        const targetCard = cards.find(card => card.dataset.cardId === id)?.getBoundingClientRect();
        if (!targetCard) return [];
        const x2 = (targetCard.left + targetCard.width / 2 - table.left) / table.width * 1800;
        const y2 = (targetCard.top + targetCard.height / 2 - table.top) / table.height * 1000;
        return [`M ${x1} ${y1} C ${x1 - 150} ${y1 - 100}, ${x2 + 170} ${y2 - 100}, ${x2} ${y2}`];
      }).join(" "));
    };
    const observer = new ResizeObserver(update); observer.observe(element); update();
    return () => observer.disconnect();
  }, [board, activeChain?.targetId, activeChain?.targetIds, activeChain?.id, previewCard?.instanceId, fullscreen]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || exploration || setupTable || openingScreen || turnStart || keywordIntro || lessonIntro) { setEffectBadges([]); setEffectArrows([]); return; }
    function update() {
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const tableRight = (element.querySelector(".atb-table")?.getBoundingClientRect().right ?? bounds.right) - bounds.left;
      const rect = (node: Element): CardRect => { const r = node.getBoundingClientRect(); return { left: r.left - bounds.left, top: r.top - bounds.top, width: r.width, height: r.height }; };
      const nodes = new Map<string, HTMLElement>();
      element.querySelectorAll<HTMLElement>('.atb-card[data-card-id]').forEach(node => nodes.set(node.dataset.cardId!, node));
      const hidden = (card: TutorialCard | undefined) => card?.owner === 'opponent' && (card.faceDown || ['hand', 'deck', 'rune-deck', 'hidden'].includes(card.zone));
      const anchor = (id: string): HTMLElement | null => {
        const direct = nodes.get(id); if (direct) return direct;
        const card = board.cards.find(item => item.instanceId === id);
        if (card) {
          if (card.zone === 'chain') return element.querySelector('.atb-chain');
          if (['deck', 'rune-deck', 'trash', 'banishment'].includes(card.zone)) return element.querySelector(`.atb-${card.zone}.atb-${card.owner}`);
          if (card.zone === 'hand') return element.querySelector(`.atb-hand.atb-${card.owner}`);
        }
        if (id === 'chain') return element.querySelector('.atb-chain');
        if (id.startsWith('battlefield-')) return element.querySelector(`[data-zone="${id}"]`);
        const [side, zone] = id.split(':');
        if (side === 'player' || side === 'opponent') return element.querySelector(`.atb-${zone === 'resources' ? 'float' : zone}.atb-${side}`);
        return null;
      };
      const candidates: Array<Omit<EffectBadge, 'left' | 'top' | 'width'> & { anchor: HTMLElement; height: number }> = [];
      for (const card of board.cards) {
        if (hidden(card) || card.type !== 'unit' || ['hand', 'deck', 'rune-deck', 'champion', 'trash', 'banishment', 'hidden'].includes(card.zone) || card.might === card.baseMight) continue;
        const node = nodes.get(card.instanceId); if (!node) continue;
        const modifiers = card.mightModifiers?.filter(modifier => modifier.amount !== 0) ?? [];
        candidates.push({ key: `might:${card.instanceId}`, kind: 'might', label: modifiers.length ? modifiers.map(modifier => `${modifier.label} ${modifier.amount > 0 ? '+' : ''}${modifier.amount}`).join(' · ') : 'Current Might', base: card.baseMight, current: card.might, modifiers, anchor: node, height: 72 });
      }
      const changes = board.impact?.changes ?? [];
      for (const [index, change] of changes.entries()) {
        // Movement and routine ready/resource changes already read directly on the table.
        if (["zone", "energy", "power"].includes(change.kind) || change.kind === "score" && scoringTeaching) continue;
        if (change.kind === "status" && !["Empowered", "attached", "stunned", "XP"].some(word => `${change.label ?? ""} ${change.after}`.toLowerCase().includes(word.toLowerCase()))) continue;
        if (change.kind === 'might' && candidates.some(candidate => candidate.key === `might:${change.cardId}`)) continue;
        const card = board.cards.find(item => item.instanceId === change.cardId);
        const confidential = hidden(card);
        const side = change.side ?? card?.owner;
        const node = (change.cardId ? anchor(change.cardId) : null) ?? (change.kind === 'zone' ? anchor(String(change.before).startsWith('battlefield-') ? String(change.before) : `${side}:${change.before}`) : null) ?? (side ? element.querySelector<HTMLElement>(change.kind === 'score' ? `.atb-score-track.atb-${side} .is-current` : `.atb-float.atb-${side}`) : null);
        if (!node) continue;
        // Entry into the chain already has a named item and a full source-card preview.
        if (change.kind === 'zone' && change.after === 'chain') continue;
        const zoneLabel: Record<string, string> = { 'battlefield-left': 'Left battlefield', 'battlefield-right': 'Right battlefield', 'rune-deck': 'Rune deck', trash: 'Trash', base: 'Base', hand: 'Hand', deck: 'Deck', banishment: 'Banished', hidden: 'Hidden' };
        const value = (item: string | number) => change.kind === 'zone' ? zoneLabel[String(item)] ?? String(item) : String(item);
        let label = change.label || (change.kind === 'zone' ? card?.name ?? 'Card moved' : change.kind === 'damage' ? Number(change.after) < Number(change.before) ? 'Damage cleared' : 'Damage dealt' : change.kind === 'energy' ? 'Energy' : change.kind === 'power' ? 'Power' : change.kind === 'score' ? 'Points' : change.kind === 'might' ? 'Might changed' : 'Status changed');
        if (confidential && card) label = label.replaceAll(card.name, 'Opponent’s card');
        candidates.push({ key: `${board.impact?.id}:${index}`, kind: change.kind, label, before: value(change.before), after: value(change.after), anchor: node, height: change.kind === "status" ? 84 : 64 });
      }
      const obstacleRects = Array.from(element.querySelectorAll<HTMLElement>('.atb-card,.atb-turn-actions,.atb-tools,.atb-pile-dialog header,.atb-deck,.atb-rune-deck,.atb-trash,.atb-float,.atb-score-track .is-current')).filter(node => node.offsetWidth && node.offsetHeight).map(node => ({ node, ...rect(node) }));
      const occupied: CardRect[] = [];
      const badges: EffectBadge[] = [];
      const width = Math.min(146, Math.max(118, bounds.width * .105));
      const overlap = (a: CardRect, b: CardRect) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
      for (const candidate of candidates.slice(0, 9)) {
        const target = rect(candidate.anchor); if (!target.width || !target.height) continue;
        const height = candidate.height;
        const raw = [{ left: target.left + target.width / 2 - width / 2, top: target.top + target.height + 6 }, { left: target.left + target.width / 2 - width / 2, top: target.top - height - 6 }, { left: target.left + target.width + 7, top: target.top + target.height / 2 - height / 2 }, { left: target.left - width - 7, top: target.top + target.height / 2 - height / 2 }];
        raw.push({ left: target.left + target.width + width / 2 + 35, top: target.top + target.height / 2 - height / 2 }, { left: target.left - width * 1.5 - 35, top: target.top + target.height / 2 - height / 2 }, { left: target.left + target.width / 2 - width / 2, top: target.top + target.height + height + 12 }, { left: target.left + target.width / 2 - width / 2, top: target.top - height * 2 - 12 });
        const choices = raw.map(point => ({ left: Math.max(6, Math.min(tableRight - width - 6, point.left)), top: Math.max(6, Math.min(bounds.height - height - 6, point.top)), width, height }));
        const score = (point: CardRect) => obstacleRects.reduce((total, obstacle) => total + overlap(point, obstacle) * 12, 0) + occupied.reduce((total, obstacle) => total + overlap(point, obstacle) * 30, 0) + Math.hypot(point.left + width / 2 - target.left - target.width / 2, point.top + height / 2 - target.top - target.height / 2);
        const best = choices.sort((a, b) => score(a) - score(b))[0];
        const { anchor: _anchor, height: _height, ...content } = candidate;
        badges.push({ ...content, left: best.left, top: best.top, width }); occupied.push(best);
      }
      const arrows: EffectArrow[] = [];
      const sources = board.impact?.sourceIds ?? [], targets = changes.filter(change => ["might", "damage"].includes(change.kind)).flatMap(change => change.cardId ? [change.cardId] : []);
      for (const targetId of [...new Set(targets)].slice(0, 3)) {
        const sourceId = sources.find(id => id !== targetId); if (!sourceId) continue;
        const sourceNode = anchor(sourceId), targetNode = anchor(targetId); if (!sourceNode || !targetNode || sourceNode === targetNode) continue;
        const source = rect(sourceNode), target = rect(targetNode);
        const x1 = source.left + source.width / 2, y1 = source.top + source.height / 2, x2 = target.left + target.width / 2, y2 = target.top + target.height / 2;
        if (Math.hypot(x2 - x1, y2 - y1) < 45) continue;
        arrows.push({ key: `${sourceId}:${targetId}`, path: `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${Math.min(y1, y2) - 36} ${x2} ${y2}` });
      }
      setEffectBadges(current => JSON.stringify(current) === JSON.stringify(badges) ? current : badges);
      setEffectArrows(current => JSON.stringify(current) === JSON.stringify(arrows) ? current : arrows);
    }
    const observer = new ResizeObserver(update); observer.observe(element); update();
    return () => observer.disconnect();
  }, [board, exploration, setupTable, openingScreen, turnStart, keywordIntro, lessonIntro, fullscreen]);
  useLayoutEffect(() => { root.current?.dispatchEvent(new CustomEvent('riftlite-guide-target-change', { bubbles: true })); }, [effectBadges, pile, menu, helpOpen, target]);

  function toggleFullscreen() {
    if (!canFullscreen) return;
    if (root.current && document.fullscreenElement?.contains(root.current)) void document.exitFullscreen().catch(() => undefined);
    else {
      const element = root.current?.closest<HTMLElement>(".nph-classroom-layout") ?? root.current;
      if (!element) return;
      element.dataset.atbFullscreen = "true";
      void element.requestFullscreen().catch(() => { delete element.dataset.atbFullscreen; });
    }
  }
  function openMenu(card: TutorialCard, clientX?: number, clientY?: number) {
    if (card.faceDown && card.owner === "opponent") return;
    const rect = root.current?.getBoundingClientRect();
    setSelectedId(card.instanceId);
    setMenu({ cardId: card.instanceId, left: rect && clientX != null ? Math.min(77, Math.max(1, (clientX - rect.left) / rect.width * 100)) : 36, top: rect && clientY != null ? Math.min(62, Math.max(2, (clientY - rect.top) / rect.height * 100)) : 35 });
  }
  function closePile() {
    setPile(null);
    if (pileOpener.current?.isConnected) pileOpener.current.focus();
    pileOpener.current = null;
  }
  function selectCard(card: TutorialCard) {
    if (groupMove) {
      if (canAct && (step?.allowedCardIds ?? groupMove.cardIds).includes(card.instanceId)) {
        setSelectedGroupIds(ids => ids.includes(card.instanceId) ? ids.filter(id => id !== card.instanceId) : [...ids, card.instanceId]);
      } else if (selectedGroupIds.length && (card.zone === "battlefield-left" || card.zone === "battlefield-right")) {
        emit({ type: "move-units", cardIds: selectedGroupIds, destination: card.zone });
      }
      return;
    }
    if (expected?.type === "move" && selectedId && card.instanceId !== selectedId && (card.zone === "battlefield-left" || card.zone === "battlefield-right" || card.zone === "base")) {
      const moving = cardById(selectedId);
      if (moving?.owner === "player" && moving.type === "unit" && moving.zone !== card.zone) { sendCard(moving, card.zone); return; }
    }
    if (target) {
      if ((target.type === "place" || target.type === "hide") && (card.zone === "battlefield-left" || card.zone === "battlefield-right")) {
        const source = cardById(target.cardId); if (source) sendCard(source, card.zone);
      }
      if (target.type === "play") emit({ type: "play", cardId: target.cardId, targetId: card.instanceId, ...(target.destination ? { destination: target.destination } : {}) });
      if (target.type === "activate") emit({ type: "activate", cardId: target.cardId, targetId: card.instanceId, ...(target.costCardId ? { costCardId: target.costCardId } : {}) });
      return;
    }
    if (card.faceDown && card.owner === "opponent") return;
    setSelectedId(card.instanceId);
    setMenu(null);
    if (exploration) return;
    if (expected?.type === "choose-trigger") {
      emit({ type: "choose-trigger", cardId: expected.cardId, targetId: card.instanceId });
    } else if (expected?.type === "spend-buff") {
      emit({ type: "spend-buff", cardId: card.instanceId });
    } else if (isMulligan && card.owner === "player" && card.zone === "hand") {
      setMulliganIds(ids => ids.includes(card.instanceId) ? ids.filter(id => id !== card.instanceId) : ids.length < 2 ? [...ids, card.instanceId] : ids);
    } else if (canAct && (expected?.type === "recycle" || expected?.type === "activate") && expected.cardId === card.instanceId) {
      openMenu(card);
    } else if (expected?.type === "move" && (expected.cardId === card.instanceId || step?.guidance === "practice" && step.allowedCardIds?.includes(card.instanceId))) {
      // Selecting the source is a UI operation; the move is sent only at its destination.
      return;
    } else if (expected?.type === "hide" && expected.cardId === card.instanceId) {
      setTarget({ type: "hide", cardId: card.instanceId });
    } else if (expected?.type === "inspect") {
      emit({ type: "inspect", cardId: card.instanceId });
    } else if (card.owner === "player" && (["hand", "champion", "hidden"].includes(card.zone) || expected?.type === "play" && expected.cardId === card.instanceId)) {
      playCard(card);
    } else if (card.owner === "player" && !["trash", "deck", "rune-deck", "chain"].includes(card.zone)) {
      emit({ type: "exhaust", cardId: card.instanceId });
    }
  }
  function renderChainItem(item: TutorialState["board"]["chain"][number], index: number) {
    const card = visibleCard(cardById(item.id));
    const details = <><small>{index === 0 ? "NEXT TO RESOLVE" : "WAITING BELOW"}</small><strong>{item.label}</strong></>;
    if (card?.zone !== "chain" || card.type !== "spell") return <li key={item.id}>{details}</li>;

    const choosingTarget = target?.type === "play" || target?.type === "activate";
    const verb = choosingTarget ? "Target" : "Inspect";
    const readSpell = () => { setHoveredId(card.instanceId); setReadCardId(card.instanceId); };
    return <li key={item.id} className="atb-chain-spell">
      <button type="button" data-chain-card-id={card.instanceId} data-hover-card-id={card.instanceId} {...guideProps(`card:${card.instanceId}`)}
        aria-label={`${verb} ${item.label} on the chain`}
        onFocus={readSpell} onBlur={() => setHoveredId(null)}
        onMouseEnter={readSpell} onMouseLeave={() => setHoveredId(null)}
        onClick={() => {
          readSpell();
          if (canAct && (expected?.type === "inspect" || choosingTarget)) selectCard(card);
        }}>
        <span>{details}</span><span className="atb-chain-verb">{verb}</span>
      </button>
    </li>;
  }
  function sendCard(card: TutorialCard, destination: TutorialZone) {
    if ((target?.type === "hide" || (expected?.type === "hide" && card.keywords.some(word => word.toLowerCase() === "hidden"))) && (destination === "battlefield-left" || destination === "battlefield-right")) {
      emit({ type: "hide", cardId: target?.cardId ?? card.instanceId, battlefieldId: destination });
    } else if (card.zone === "hand" || card.zone === "champion" || card.zone === "hidden" || expected?.type === "play" && expected.cardId === card.instanceId) {
      emit({ type: "play", cardId: card.instanceId, destination });
    } else emit({ type: "move", cardId: card.instanceId, destination });
    setMenu(null);
  }
  function drop(event: React.DragEvent, destination: TutorialZone) {
    event.preventDefault(); event.stopPropagation();
    if (groupMove) return;
    if (setupTable) { placeSetupPiece(destination, event.dataTransfer.getData("application/x-riftlite-setup-piece")); return; }
    const card = cardById(event.dataTransfer.getData("application/x-riftlite-tutorial-card") || draggingId);
    if (card?.owner === "player") sendCard(card, destination);
    setDraggingId(null);
  }
  function zoneClick(destination: TutorialZone) {
    if (groupMove) {
      if (destination === "battlefield-left" || destination === "battlefield-right") emit({ type: "move-units", cardIds: selectedGroupIds, destination });
      return;
    }
    if (setupTable) { if (setupSelection) placeSetupPiece(destination); else if (expected?.type === "setup" && expected.item === "opening-hand" && destination === "deck") emit({ type: "setup", item: "opening-hand" }); else if (expected?.type === "inspect") emit({ type: "inspect", cardId: `player:${destination}` }); return; }
    const card = cardById(target?.cardId ?? selectedId);
    if (card?.owner === "player") sendCard(card, destination);
  }
  function playCard(card: TutorialCard) {
    setMenu(null);
    const guidedPlay = expected?.type === "play" && expected.cardId === card.instanceId ? expected : undefined;
    if (guidedPlay?.targetId || card.type === "spell" && !guidedPlay) {
      // Target selection is an explicit player interaction, never an inferred target.
      setTarget({ type: "play", cardId: card.instanceId, ...(guidedPlay?.destination ? { destination: guidedPlay.destination } : card.zone === "hidden" && card.hiddenAt ? { destination: card.hiddenAt } : {}) });
      setPile(null);
    } else if (guidedPlay?.destination?.startsWith("battlefield-") && (card.zone === "hand" || card.zone === "champion")) {
      setTarget({ type: "place", cardId: card.instanceId }); setPile(null);
    } else if (guidedPlay && card.type === "spell") emit({ type: "play", cardId: card.instanceId, ...(guidedPlay.destination ? { destination: guidedPlay.destination } : {}) });
    else sendCard(card, guidedPlay?.destination ?? "base");
  }
  function activateCard(card: TutorialCard) {
    if (exploration || card.owner !== "player") return;
    setSelectedId(card.instanceId); setMenu(null);
    const guided = expected?.type === "activate" && expected.cardId === card.instanceId ? expected : undefined;
    const payment = guided?.costCardId ? { costCardId: guided.costCardId } : {};
    if (guided?.targetId) setTarget({ type: "activate", cardId: card.instanceId, ...payment });
    else emit({ type: "activate", cardId: card.instanceId, ...payment });
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (exploration) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [role=menu]")) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (enlargedReader) { if (event.key === "Escape") { event.preventDefault(); closeReader(); } return; }
    if (event.key === "Escape") { setMenu(null); setTarget(null); if (pile) closePile(); setHelpOpen(false); return; }
    if (event.key === "F10" && event.shiftKey && selectedId) {
      const card = cardById(selectedId); if (card) { event.preventDefault(); openMenu(card); } return;
    }
    const key = event.key.toLowerCase();
    const actions: Record<string, TutorialAction> = { d: { type: "draw" }, a: { type: "pass" }, s: { type: "resolve" }, q: { type: "score" }, w: { type: "pass" } };
    if (key === "r" && onUndo) { event.preventDefault(); onUndo(); }
    else if (key === " " && event.target === event.currentTarget) { event.preventDefault(); emit({ type: "end-turn" }); }
    else if (actions[key]) { event.preventDefault(); emit(actions[key]); }
  }
  function cardView(card: TutorialCard, extraClass = "", index = 0, total = 1, isAttachment = false): React.ReactNode {
    const concealed = card.faceDown || (card.owner === "opponent" && card.zone === "hand");
    const canInspect = Boolean(card.cardId) && !(concealed && card.owner === "opponent");
    const art = concealed ? "" : resolveCardArtwork(card.cardId, card.imageUrl);
    const focus = !practiceHidden && (step?.focusIds.includes(card.instanceId) || step?.focusIds.includes(card.cardId));
    const returnAssignment = combatDemo?.data.returnAssignments?.find(item => item.cardId === card.instanceId);
    const assignment = combatDemo?.data.targetAssignments.find(item => item.cardId === card.instanceId) ?? (returnAssignment ? { ...returnAssignment, order: (combatDemo?.data.targetAssignments.length ?? 0) + (returnAssignment.order ?? 1) } : undefined) ?? (board.combat?.assignments[card.instanceId] != null ? { amount: board.combat.assignments[card.instanceId], order: 1 } : undefined);
    const cardElement = <button key={card.instanceId} type="button" className={`atb-card ${extraClass}`} data-card-id={card.instanceId} data-ready={card.ready} data-concealed={concealed} data-selected={selectedId === card.instanceId || selectedGroupIds.includes(card.instanceId) || mulliganIds.includes(card.instanceId)} data-focus={focus || undefined} data-guide-acting={automatic && focus || undefined} data-impact-source={board.impact?.sourceIds?.includes(card.instanceId) || undefined} data-impact-target={board.impact?.targetIds?.includes(card.instanceId) || undefined} data-in-flight={flights.some(flight => flight.cardId === card.instanceId) || undefined} data-combat-assigned={Boolean(assignment) || undefined} title={canInspect ? card.annotation : undefined} {...guideProps(`card:${card.instanceId}`)}
      data-hover-card-id={canInspect ? card.instanceId : undefined} style={{ "--fan-index": index - (total - 1) / 2, "--fan-total": total } as React.CSSProperties}
      aria-label={concealed ? `${card.owner === "opponent" ? "Opponent's" : "Your"} face-down card` : `${card.name}${card.ready ? "" : ", exhausted"}${card.damage ? `, ${card.damage} damage` : ""}${assignment ? `, ${assignment.amount} combat damage ${card.damage > 0 ? "dealt" : "assigned"}` : ""}`}
      aria-pressed={selectedId === card.instanceId || selectedGroupIds.includes(card.instanceId) || mulliganIds.includes(card.instanceId)} draggable={canAct && card.owner === "player" && !isMulligan && !groupMove}
      onClick={event => { event.stopPropagation(); if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) activateCard(card); else if (!event.ctrlKey && !event.metaKey && !event.altKey) selectCard(card); }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!event.ctrlKey && !event.metaKey && !event.altKey && card.owner === "player") emit(card.type === "rune" ? { type: "recycle", cardId: card.instanceId } : { type: "move", cardId: card.instanceId, destination: "trash" }); }}
      onMouseEnter={() => { if (canInspect) { setHoveredId(card.instanceId); setReadCardId(card.instanceId); } }} onMouseLeave={() => setHoveredId(null)}
      onFocus={() => { if (canInspect) { setHoveredId(card.instanceId); setReadCardId(card.instanceId); } }} onBlur={() => setHoveredId(null)}
      onDragStart={event => { setHoveredId(null); event.dataTransfer.setData("application/x-riftlite-tutorial-card", card.instanceId); event.dataTransfer.effectAllowed = "move"; setDraggingId(card.instanceId); setMenu(null); }} onDragEnd={() => setDraggingId(null)}
      onKeyDown={event => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); event.stopPropagation(); activateCard(card); } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) { event.preventDefault(); event.stopPropagation(); if (card.owner === "player") emit(card.type === "rune" ? { type: "recycle", cardId: card.instanceId } : { type: "move", cardId: card.instanceId, destination: "trash" }); } }}>
      {art ? <img src={art} alt="" draggable={false} loading="eager" /> : concealed ? <img src={card.type === "rune" ? runeCardBack : mainCardBack} alt="" draggable={false} /> : <span className="atb-card-back"><small>{card.name}</small></span>}
      {!concealed && card.might > 0 && card.zone !== "hand" && card.zone !== "champion" ? <span className="atb-might" data-modified={card.might !== card.baseMight}>{card.might}</span> : null}
      {!concealed && card.empowered && <span className="atb-empowered">Empowered</span>}
      {!concealed && card.stunned && <span className="atb-stunned">Stunned</span>}
      {!concealed && (card.buffCount ?? 0) > 0 && <span className="atb-buff-counter" aria-label={`${card.buffCount} Buff counter`}>+{card.buffCount} Buff</span>}
      {!concealed && card.damage > 0 ? <span className="atb-damage">{card.damage}</span> : null}
      {assignment && <span key={combatDemo?.actionCount ?? "saved"} className="atb-assigned-damage" data-animate={combatDemo?.animate ?? false} style={{ "--assignment-delay": `${((assignment.order ?? 1) - 1) * 650}ms` } as React.CSSProperties}><b>{card.damage > 0 ? card.damage : assignment.amount}</b><small>{card.damage > 0 ? "dealt" : "assigned"}</small></span>}
      {mulliganIds.includes(card.instanceId) ? <span className="atb-mulligan-mark">Return</span> : null}
    </button>;
    const attachments = !isAttachment ? board.cards.filter(item => item.attachedTo === card.instanceId) : [];
    return attachments.length ? <div key={card.instanceId} className="atb-equipped-card" aria-label={`${card.name} with attached equipment`}>{attachments.map(item => cardView(item, "atb-attached-card", 0, 1, true))}{cardElement}<span className="atb-attached-label">{attachments.length} equipped</span></div> : cardElement;
  }
  const cardsIn = (side: TutorialSide, zone: TutorialZone) => board.cards.filter(card => card.owner === side && card.zone === zone && !card.attachedTo);
  function pileButton(side: TutorialSide, kind: "deck" | "rune-deck" | "trash") {
    const player = board.players[side];
    const count = kind === "deck" ? player.deckCount : kind === "rune-deck" ? player.runeDeckCount : cardsIn(side, "trash").length;
    const label = kind === "deck" ? "Main deck" : kind === "rune-deck" ? "Rune deck" : "Trash";
    const top = kind === "trash" ? cardsIn(side, "trash").at(-1) : undefined;
    const waiting = setupTable && kind !== "trash" && !board.setup?.completedItems.includes(kind === "deck" ? "main-deck" : "rune-deck");
    const inspectingDeck = side === "player" && kind === "deck" && expected && "cardId" in expected && cardById(expected.cardId)?.zone === "deck";
    return <button type="button" className={`atb-pile atb-${kind} atb-${side}`} data-setup-empty={waiting || undefined} data-guide-acting={autoFocus(`${side}:${kind}`, side === "player" ? kind : "")} {...(side === "player" ? guideProps(kind) : {})} aria-label={`${player.name}: ${label}, ${count} cards${!exploration && side === "player" && kind === "deck" ? inspectingDeck ? ". Open to inspect cards" : ". Draw a card (D)" : !exploration && side === "player" && kind === "rune-deck" ? ". Channel runes" : ""}`}
      onClick={event => kind === "trash" || inspectingDeck ? setPile({ side, zone: kind === "trash" ? "trash" : "deck" }) : side === "player" ? emit(kind === "deck" ? { type: "draw" } : { type: "channel", ready: event.ctrlKey || event.metaKey }) : undefined}
      onContextMenu={event => { event.preventDefault(); if (kind === "trash" || kind === "deck" && side === "player") setPile({ side, zone: kind }); }} onKeyDown={event => { if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) { event.preventDefault(); event.stopPropagation(); if (kind === "trash" || kind === "deck" && side === "player") setPile({ side, zone: kind }); } }} onDragOver={event => { if (side === "player") event.preventDefault(); }} onDrop={event => { if (side === "player" && kind === "trash") drop(event, "trash"); }} {...(side === "player" ? setupZoneProps(kind) : {})}>
      {waiting ? <span className="atb-setup-slot-label">{label}</span> : top ? <img src={resolveCardArtwork(top.cardId, top.imageUrl)} alt="" /> : kind !== "trash" ? <img src={kind === "rune-deck" ? runeCardBack : mainCardBack} alt="" /> : <span className="atb-card-back"><small>{label}</small></span>}
      {!waiting && <b>{count}</b>}
    </button>;
  }
  function playerArea(side: TutorialSide) {
    const player = board.players[side];
    const hand = cardsIn(side, "hand");
    const runes = cardsIn(side, "runes");
    return <React.Fragment key={side}>
      <div className={`atb-name atb-${side}`}>{player.name}<small>{side === "player" ? "You" : exploration ? "Opponent" : "Scripted opponent"}</small><span className="atb-timer" aria-label="Match timer paused during lessons">00:00</span></div>
      <div className={`atb-score-track atb-${side}`} data-guide-acting={autoFocus(`${side}:score`)} data-scoring-result={scoringTeaching && !scoringTeaching.pending && scoringTeaching.side === side ? scoringTeaching.result : undefined} aria-label={`${player.name}: ${player.score} points`}>
        {Array.from({ length: 9 }, (_, score) => <span key={score} className={player.score === score ? "is-current" : ""}>{score}</span>)}
      </div>
      {pileButton(side, "deck")}{pileButton(side, "rune-deck")}{pileButton(side, "trash")}
      {cardsIn(side, "banishment").length > 0 && <button type="button" className={`atb-banishment atb-${side}`} {...(side === "player" ? guideProps("banishment") : {})} onClick={() => setPile({ side, zone: "banishment" })}>Banished · {cardsIn(side, "banishment").length}</button>}
      <div className={`atb-float atb-${side}`} data-guide-acting={autoFocus(`${side}:resources`)} data-zone={side === "player" ? "resources" : undefined} aria-label={`Available resources: ${player.energy} energy, ${Object.values(player.power).reduce((sum, value) => sum + (value ?? 0), 0)} power`}><small>AVAILABLE</small><span>Energy <b>{player.energy}</b></span><span>Power <b>{Object.values(player.power).reduce((sum, value) => sum + (value ?? 0), 0)}</b></span>{player.xp !== undefined && <span className="atb-xp">XP <b>{player.xp}</b></span>}</div>
      <div className={`atb-runes atb-${side}`} data-guide-acting={autoFocus(`${side}:runes`, side === "player" ? "runes" : "")} aria-label={`${player.name}: rune area`}><div>{runes.map((card, index) => cardView(card, "", index, runes.length))}</div><small>{runes.filter(card => card.ready).length}/{runes.length}</small></div>
      <div className={`atb-base atb-${side}`} data-zone={side === "player" ? "base" : undefined} data-guide-acting={autoFocus(`${side}:base`, side === "player" ? "base" : "")} role="group" aria-label={`${player.name}: base`} tabIndex={side === "player" ? 0 : -1} data-drop-active={Boolean(draggingId) && side === "player"} {...(side === "player" ? guideProps("zone:base") : {})}
        onClick={() => side === "player" && zoneClick("base")} onKeyDown={event => { if (side === "player" && event.key === "Enter" && event.currentTarget === event.target) zoneClick("base"); }} onDragOver={event => { if (side === "player") event.preventDefault(); }} onDrop={event => { if (side === "player") drop(event, "base"); }} {...(side === "player" ? setupZoneProps("base") : {})}>
        <span className="atb-zone-label">BASE</span><span className="atb-brand-mark" aria-hidden="true"><img src={riftLiteLogo} alt="" /><span>RiftLite</span></span><div>{cardsIn(side, "base").map(card => cardView(card))}</div>
      </div>
      <div className={`atb-heroes atb-${side}`}>{(["legend", "champion"] as const).map(zone => <div key={zone} data-guide-acting={autoFocus(`${side}:${zone}`)} aria-label={`${player.name}: ${zone === "legend" ? "legend" : "chosen champion"}`} {...(side === "player" ? setupZoneProps(zone) : {})}>{cardsIn(side, zone).map(card => cardView(card))}{!cardsIn(side, zone).length && <span className="atb-empty-card">{zone === "legend" ? "Legend" : <>Chosen<br />champion</>}</span>}</div>)}</div>
      <div className={`atb-hand atb-${side}`} data-guide-acting={autoFocus(`${side}:hand`, side === "player" ? "hand" : "")} aria-label={`${player.name}: hand, ${player.handCount ?? hand.length} cards`} {...(side === "player" ? setupZoneProps("hand") : {})}>{setupTable && hand.length === 0 && <span className="atb-setup-hand-label">Your hand · cards you can play</span>}{board.practice && <span className="atb-hand-count">Hand · {player.handCount ?? hand.length}</span>}{hand.map((card, index) => cardView(card, "atb-hand-card", index, hand.length))}</div>
    </React.Fragment>;
  }

  function deckDetails(side: TutorialSide) {
    const deck = getNewPlayerTeachingDeck(board.players[side].teachingDeckId);
    if (!deck) return null;
    return <section className="atb-deck-provenance" aria-label="Teaching deck source"><small>{deck.kind === "published" ? "PUBLISHED PILTOVER ARCHIVE LIST" : "RIFTLITE LEGAL TEACHING DECK"}</small><strong>{deck.title}</strong><p>{deck.notes}</p><span>{deck.main.reduce((sum, entry) => sum + entry.quantity, 0)} Main Deck cards including the chosen champion · {deck.runes.reduce((sum, entry) => sum + entry.quantity, 0)} runes · {deck.battlefields.reduce((sum, entry) => sum + entry.quantity, 0)} battlefields</span><details className="atb-full-deck"><summary>Complete starting list · not current deck order</summary><p>Chosen champion: {NEW_PLAYER_TEACHING_CARD_FACTS[deck.championId]?.name ?? deck.championId}. This copy is included in the 40 Main Deck cards below.</p>{([["Main Deck", deck.main], ["Runes", deck.runes], ["Battlefields", deck.battlefields], ["Sideboard", deck.sideboard]] as const).filter(([, entries]) => entries.length).map(([label, entries]) => <section key={label}><strong>{label} · {entries.reduce((sum, entry) => sum + entry.quantity, 0)}</strong><ul>{entries.map(entry => <li key={entry.cardId}><b>{entry.quantity}×</b> {NEW_PLAYER_TEACHING_CARD_FACTS[entry.cardId]?.name ?? entry.cardId}</li>)}</ul></section>)}</details>{deck.kind === "published" && deck.sourceUrl && onOpenExternal && <button type="button" onClick={() => onOpenExternal(deck.sourceUrl!)}>View published list{deck.author ? ` · ${deck.author}` : ""}</button>}</section>;
  }

  function setupPieces(): SetupPiece[] {
    if (expected?.type !== "setup" || !expected.destination) return [];
    if (expected.item === "battlefields") return (board.setup?.battlefieldOptions ?? []).map(field => ({ key: field.cardId, name: field.name, image: field.imageUrl, landscape: true, action: { type: "setup", item: "battlefields", cardId: field.cardId } }));
    if (expected.item === "legend" || expected.item === "champion") {
      const card = cardById(expected.cardId); return card ? [{ key: card.instanceId, name: card.name, image: resolveCardArtwork(card.cardId, card.imageUrl), action: { type: "setup", item: expected.item, cardId: card.instanceId } }] : [];
    }
    return [{ key: expected.item, name: expected.item === "main-deck" ? "Your Main Deck" : "Your Rune Deck", image: expected.item === "main-deck" ? mainCardBack : runeCardBack, action: { type: "setup", item: expected.item } }];
  }
  function placeSetupPiece(destination: TutorialZone, key?: string) {
    const piece = key ? setupPieces().find(item => item.key === key) : setupSelection;
    if (piece) emit({ ...piece.action, destination });
  }
  function setupZoneProps(zone: TutorialZone) {
    return setupTable ? { "data-setup-zone": zone, "data-setup-destination": expected?.type === "setup" && expected.destination === zone || undefined, ...guideProps(expected?.type === "setup" && expected.item === "opening-hand" && zone === "deck" ? "setup:opening-hand:" : `setup-zone:${zone}`), tabIndex: 0, role: "button" as const,
      onClick: (event: React.MouseEvent) => { event.stopPropagation(); zoneClick(zone); },
      onKeyDown: (event: React.KeyboardEvent) => { if (["Enter", " "].includes(event.key) && event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); zoneClick(zone); } },
      onDragOver: (event: React.DragEvent) => event.preventDefault(), onDrop: (event: React.DragEvent) => drop(event, zone) } : {};
  }
  function setupTray() {
    const pieces = setupPieces();
    return <>
      {pieces.length > 0 && <section className="atb-setup-tray" aria-label="Pieces to place" data-battlefields={pieces.length > 1}>
        <header><strong>{expected?.type === "setup" && expected.item === "battlefields" ? "Choose your battlefield" : "Your next piece"}</strong><span>Drag the piece into the outlined space, or select the piece and then the space. You can use Enter for both.</span></header>
        <div>{pieces.map(piece => <button type="button" key={piece.key} className="atb-setup-piece" data-setup-source={piece.key} data-card-id={piece.key.startsWith("p-") ? piece.key : undefined} data-hover-card-id={piece.action.cardId} data-selected={setupSelection?.key === piece.key} {...guideProps(`setup-piece:${piece.key}`)} draggable={canAct} disabled={!canAct}
          onMouseEnter={() => { if (piece.action.cardId) { setHoveredId(piece.action.cardId); setReadCardId(piece.action.cardId); } }} onMouseLeave={() => setHoveredId(null)} onFocus={() => { if (piece.action.cardId) { setHoveredId(piece.action.cardId); setReadCardId(piece.action.cardId); } }} onBlur={() => setHoveredId(null)} onClick={() => setSetupSelection(piece)} onDragStart={event => { setHoveredId(null); setSetupSelection(piece); event.dataTransfer.setData("application/x-riftlite-setup-piece", piece.key); event.dataTransfer.effectAllowed = "move"; }}>
          {piece.landscape ? <BattlefieldArtwork cardId={piece.key} imageUrl={piece.image} name={piece.name} /> : <img src={piece.image} alt="" />}<strong>{piece.name}</strong>
        </button>)}</div>
      </section>}
      {expected?.type === "setup" && expected.item === "turn-order" && <section className="atb-setup-order" aria-label="Choose turn order"><p>You’ve won the choice of who goes first, so choose to go first and we’ll play out that opening together.</p>{(["first", "second"] as const).map(choice => <button type="button" key={choice} {...guideProps(`setup:turn-order:${choice}`)} disabled={!canAct} onClick={() => emit({ type: "setup", item: "turn-order", choice })}>{choice === "first" ? "Go first" : "Go second"}</button>)}</section>}
    </>;
  }
  function lessonPurpose() {
    const intro = step?.lessonIntro;
    return intro ? <dl className="atb-lesson-purpose"><div><dt>You’ll see</dt><dd>{intro.see}</dd></div><div><dt>You’ll do</dt><dd>{intro.do}</dd></div><div><dt>Why it helps</dt><dd>{intro.why}</dd></div></dl> : null;
  }

  function lessonIntroView() {
    const lesson = LESSONS.find(item => item.id === state.lessonId);
    const introState = step?.keywordScenarioId ? applyTutorialAction(state, step.expectedAction) : state;
    const context = getTutorialLessonContext(introState);
    const introduction = step && !["lesson-intro", "practice-intro"].includes(step.id) ? step.instruction : lesson?.description ?? step?.instruction;
    return <section className="atb-lesson-intro" aria-labelledby="atb-lesson-intro-title"><div className="atb-lesson-intro-copy"><small>BEFORE WE BEGIN</small><h2 id="atb-lesson-intro-title">{step?.title ?? lesson?.title.replace(/^\d+\.\s*/, "")}</h2><p>{introduction}</p>{lessonPurpose()}<aside className="atb-position-context" data-kind={context.kind}><strong>{context.title}</strong><p>{context.explanation}</p><small>{context.position}</small></aside><footer><button type="button" className="atb-splash-back" onClick={onUndo} disabled={!onUndo || !state.history.length}><ArrowLeft />Back</button><button type="button" className="atb-lesson-start" {...guideProps("lesson-intro")} disabled={!canAct} onClick={() => emit({ type: "continue" })}>{step?.label ?? "Start this lesson"}<ArrowRight /></button></footer></div><LessonIllustration lessonId={state.lessonId} board={introState.board} step={step} /></section>;
  }
  function mulliganIntroView() {
    const example = cardById("p-opening-ahri");
    return <section className="atb-mulligan-intro" aria-labelledby="atb-mulligan-intro-title">
      <header><small>BEFORE YOUR FIRST TURN</small><h2 id="atb-mulligan-intro-title">{step?.title}</h2><p>{step?.instruction}</p></header>
      <div className="atb-mulligan-rules" aria-label="Mulligan rules"><span><b>0–2</b> cards replaced</span><span><b>Once</b> before play</span><span><b>4 cards</b> in your hand after</span><span><b>No cost</b> in energy or power</span></div>
      <ol className="atb-mulligan-sequence">
        <li><div className="atb-mulligan-diagram" aria-hidden="true"><img src={mainCardBack} alt="" /><ArrowRight /><span className="atb-set-aside-card"><img src={mainCardBack} alt="" /></span></div><b>1 · Set the cards aside</b><p>Pick the cards you want to swap and leave them off to one side for a moment.</p></li>
        <li><div className="atb-mulligan-diagram" aria-hidden="true"><span className="atb-mini-deck"><img src={mainCardBack} alt="" /></span><ArrowRight /><img src={mainCardBack} alt="" /></div><b>2 · Draw your replacements</b><p>If you set one card aside, draw one from the top of your main deck, and if you set two aside, draw two.</p></li>
        <li><div className="atb-mulligan-diagram" aria-hidden="true"><span className="atb-set-aside-card"><img src={mainCardBack} alt="" /></span><ArrowRight /><span className="atb-mini-deck atb-deck-bottom"><img src={mainCardBack} alt="" /></span></div><b>3 · Recycle the originals</b><p>Now put the cards you set aside on the bottom of your main deck, in a random order if there are two. That’s what recycle means here.</p></li>
      </ol>
      <aside className="atb-mulligan-why">{example && <img src={resolveCardArtwork(example.cardId, example.imageUrl)} alt={example.name} />}<div><strong>Your opening hand</strong><p>{step?.lessonIntro?.see}</p><p>{step?.lessonIntro?.why}</p></div></aside>
      <footer><button type="button" className="atb-splash-back" onClick={onUndo} disabled={!onUndo || !state.history.length}><ArrowLeft />Back</button><span>You’ll get a look at all four before you choose.</span><button type="button" className="atb-mulligan-start" {...guideProps("mulligan-intro")} disabled={!canAct} onClick={() => emit({ type: "continue" })}>{step?.label ?? "Look at my opening hand"}<ArrowRight /></button></footer>
    </section>;
  }

  function openingView() {
    const hand = cardsIn("player", "hand");
    const firstHand = state.lessonId === "opening-hand";
    let handTip = "Hover over a card or focus it to read it, then select the highlighted card when you’re ready. Your chosen champion is still in its own zone.";
    if (firstHand) {
      handTip = expected?.type === "inspect" ? "Select the highlighted card to take a closer look." : "Continue when you’ve finished looking at your hand.";
    }
    if (isMulligan) {
      handTip = firstHand
        ? "Select just the Ahri in your hand, then choose Replace 1 card. If you’ve marked another card as well, select it again to keep it."
        : "Select a marked card again if you want to keep it. Set the others aside and draw that many replacements, then recycle the originals to the bottom of your deck.";
    }
    return <section className="atb-opening atb-mulligan-screen" aria-label="Opening hand and mulligan">
      <header className="atb-opening-heading"><div><small>YOUR OPENING FOUR</small><h2>{firstHand ? "What would you keep?" : "Give yourself a playable start"}</h2>{!firstHand && <p>Have a look at what you can play on turn one. If the hand already gives you a good start you can keep all four, or you can use your one mulligan to replace up to two.</p>}</div><button type="button" onClick={onUndo} disabled={!state.history.length || !onUndo} aria-label="Rewind last action (R)"><RotateCcw /> Rewind</button></header>
      <div className="atb-opening-hand">{hand.map((card, index) => <div className="atb-opening-choice" key={card.instanceId}>{cardView(card, "atb-opening-card", index, hand.length)}<strong>{card.name}</strong><small>{card.energyCost} energy{card.powerCost ? ` · ${card.powerCost} ${card.domain} power` : ""}</small></div>)}</div>
      <footer className="atb-opening-footer"><div className="atb-opening-deck" data-animation-pile="player:deck" aria-hidden="true"><img src={mainCardBack} alt="" /><small>Main deck</small></div><div><strong>{isMulligan ? `${mulliganIds.length} of 2 selected` : state.completed ? "Your hand is ready" : "Read your hand"}</strong><span>{handTip}</span></div>{isMulligan && <button type="button" {...guideProps("mulligan")} onClick={() => emit({ type: "mulligan", cardIds: mulliganIds })} disabled={!canAct || !guidedMulliganReady}>{mulliganButtonLabel}<ArrowRight /></button>}</footer>
    </section>;
  }

  function turnStartView() {
    const unit = board.cards.find(card => card.owner === "player" && card.type === "unit" && !card.faceDown);
    const rune = board.cards.find(card => card.owner === "player" && card.type === "rune");
    const battlefield = board.battlefields[0];
    const phases = [
      { letter: "A", name: "Awaken", detail: "Ready your exhausted cards by turning them upright, so you can use them again this turn.", icon: <RotateCcw />, image: unit ? resolveCardArtwork(unit.cardId, unit.imageUrl) : mainCardBack },
      { letter: "B", name: "Beginning", detail: "Check your Beginning effects, then look at which battlefields you still control, because this is when you score for holding.", icon: <Eye />, image: battlefield ? resolveCardArtwork(battlefield.cardId, battlefield.imageUrl) : mainCardBack },
      { letter: "C", name: "Channel", detail: "Bring two runes out of your rune deck ready to use, or three if you’re going second and it’s your first turn.", icon: <Zap />, image: rune ? resolveCardArtwork(rune.cardId, rune.imageUrl) : runeCardBack },
      { letter: "D", name: "Draw", detail: "Draw the top card of your main deck into your hand. You get that draw even if you’re going first.", icon: <ArrowRight />, image: mainCardBack },
    ];
    return <section className="atb-turn-start" aria-labelledby="atb-turn-start-title"><header><small>YOUR HAND IS READY</small><h2 id="atb-turn-start-title">Every turn starts with <em>ABCD.</em></h2><p>Before you make a play in Main, there are four things to check in order.</p></header>{lessonPurpose()}<ol>{phases.map(phase => <li key={phase.letter} data-phase={phase.letter}><div className="atb-phase-art" aria-hidden="true"><b>{phase.letter}</b><img src={phase.image} alt="" /></div><div>{phase.icon}<h3>{phase.name}</h3><p>{phase.detail}</p></div></li>)}</ol><div className="atb-main-phase"><ArrowRight /><div><strong>Then, your Main phase</strong><span>Play cards, move units, and contest battlefields.</span></div></div><footer><button type="button" className="atb-splash-back" onClick={onUndo} disabled={!onUndo || !state.history.length}><ArrowLeft />Back</button><span>You chose to go first, so it’s your Awaken.</span><button type="button" {...guideProps("turn-start")} disabled={!canAct} onClick={() => emit({ type: "continue" })}>{step?.label ?? "Start my first turn"}<ArrowRight /></button></footer></section>;
  }

  function keywordIntroView() {
    const scenario = NEW_PLAYER_KEYWORD_SCENARIOS.find(item => item.id === step?.keywordScenarioId);
    if (!scenario) return null;
    return <section className="atb-keyword-intro" aria-labelledby="atb-keyword-intro-title" data-keyword={scenario.keyword}>
      <div className="atb-keyword-intro-art"><LessonIllustration lessonId={state.lessonId} board={board} step={step} /></div>
      <div className="atb-keyword-intro-copy"><small>MEET THE KEYWORD</small><h2 id="atb-keyword-intro-title">{scenario.keyword}</h2><p className="atb-keyword-definition">{scenario.definition}</p><div className="atb-keyword-preview"><strong>{scenario.objective ? "Your goal" : "Coming up on the table"}</strong><p>{scenario.objective?.goal ?? step?.instruction ?? scenario.instruction}</p></div>{scenario.objective && <dl className="atb-keyword-comparison"><div><dt>Without {scenario.keyword}</dt><dd>{scenario.objective.without}</dd></div><div><dt>With {scenario.keyword}</dt><dd>{scenario.objective.with}</dd></div></dl>}<p className="atb-keyword-intro-note">You’ll make the plays on your side of the table. If you want another look at a move, use Pause or Back, or choose Next move when you’re ready.</p><footer><button type="button" className="atb-splash-back" onClick={onUndo} disabled={!onUndo || !state.history.length}><ArrowLeft />Back</button><button type="button" className="atb-keyword-start" {...guideProps("keyword-intro")} disabled={!canAct} onClick={() => emit({ type: "continue" })}>{step?.label ?? "Start the example"}<ArrowRight /></button></footer></div>
    </section>;
  }

  return <div className="atlas-tutorial-board" ref={root} tabIndex={0} onKeyDown={onKeyDown} aria-label={exploration ? "Atlas board explorer" : "Interactive tutorial table"} data-mode={mode} data-setup={setupTable} data-automatic={automatic} data-guide-destination={!exploration && !practiceHidden && (expected?.type === "setup" && expected.destination ? expected.destination : (expected?.type === "move" || expected?.type === "move-units") ? expected.destination : expected?.type === "hide" ? expected.battlefieldId : expected?.type === "play" && expected.destination?.startsWith("battlefield-") ? expected.destination : undefined)} data-dragging={Boolean(draggingId)} data-targeting={Boolean(target)} data-opening={openingScreen || turnStart || keywordIntro || lessonIntro} data-decision={Boolean(step?.decision)}>
    {(lessonIntro || mulliganIntro || turnStart || keywordIntro) && <div className="atb-splash-brand" aria-hidden="true"><img src={riftLiteLogo} alt="" /><span>RiftLite</span></div>}
    {lessonIntro ? lessonIntroView() : mulliganIntro ? mulliganIntroView() : keywordIntro ? keywordIntroView() : turnStart ? turnStartView() : openingScreen ? openingView() : <><div className="atb-table" onClick={() => menu && setMenu(null)}>
      {playerArea("opponent")}{playerArea("player")}
      <div className="atb-battlefields">
        {board.battlefields.map(field => <section key={field.id} className="atb-battlefield" data-scoring-status={showScoringStatus || undefined} data-action-open={battlefieldAction === field.id || undefined} data-guide-acting={autoFocus(field.id)} aria-label={field.name} data-zone={field.id} data-drop-active={Boolean(draggingId || target?.type === "hide")} tabIndex={0} {...guideProps(`zone:${field.id}`)}
          onClick={() => zoneClick(field.id)} onKeyDown={event => { if (event.key === "Enter" && event.target === event.currentTarget) zoneClick(field.id); }} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, field.id)} {...setupZoneProps(field.id)}>
          <div className="atb-field-side atb-opponent">{cardsIn("opponent", field.id).map(card => cardView(card))}</div>
          <button className="atb-battlefield-card" type="button" data-hover-card-id={!setupTable || board.setup?.completedItems.includes("battlefields") ? field.id : undefined} {...guideProps(`card:${field.id}`)} onMouseEnter={() => { if (!setupTable || board.setup?.completedItems.includes("battlefields")) { setHoveredId(field.id); setReadCardId(field.id); } }} onMouseLeave={() => setHoveredId(null)} onFocus={() => { if (!setupTable || board.setup?.completedItems.includes("battlefields")) { setHoveredId(field.id); setReadCardId(field.id); } }} onBlur={() => setHoveredId(null)} onClick={event => { event.stopPropagation(); if (setupTable && setupSelection) placeSetupPiece(field.id); else if (step?.expectedAction.type === "inspect") emit({ type: "inspect", cardId: field.id }); else zoneClick(field.id); }} aria-label={`${field.name}${field.controller ? `, controlled by ${board.players[field.controller].name}` : ""}. Move selected unit here`}>
            {setupTable && !board.setup?.completedItems.includes("battlefields") ? <span className="atb-setup-slot-label">{field.id === "battlefield-left" ? "Your battlefield" : "Opponent’s battlefield"}</span> : <><img src={resolveCardArtwork(field.cardId, field.imageUrl)} alt={field.name} /><span>{field.name}</span></>}
          </button>
          <div className="atb-field-side atb-player">{cardsIn("player", field.id).map(card => cardView(card))}{board.cards.filter(card => card.zone === "hidden" && card.hiddenAt === field.id).map(card => cardView(card))}</div>
          {board.combat?.battlefieldId === field.id ? <span className="atb-showdown">SHOWDOWN · {board.priority ? `${board.players[board.priority].name}'s ${board.chain.length ? "priority" : "focus"}` : "Resolve combat"}</span> : null}
          {battlefieldAction === field.id && <div className="atb-battlefield-actions" role="group" aria-label={`Actions at ${field.name}`}>
            {expected?.type === "pass" ? <button type="button" {...guideProps("pass")} onClick={event => { event.stopPropagation(); emit({ type: "pass" }); }}>{passLabel} <kbd>W</kbd></button>
              : <button className="atb-score-action" type="button" {...guideProps("score")} onClick={event => { event.stopPropagation(); emit({ type: "score" }); }}>{board.phase === "Beginning" ? "Hold + Score" : "Conquer"} <kbd>Q</kbd></button>}
          </div>}
          <div className="atb-field-footer">
            <span className="atb-field-control" title={field.controller ? `Controlled by ${board.players[field.controller].name}` : "No player controls this battlefield"}>{field.controller ? board.players[field.controller].name : "Uncontrolled"}</span>
            {showScoringStatus && <div className="atb-scored-status" role="group" aria-label={`${field.name}: scored this turn, turn ${board.turn}`} aria-live="polite" aria-atomic="true" title="Each player can score each battlefield once per turn. These marks track scoring, separately from control.">
              <span className="atb-scored-label" aria-hidden="true">Scored<span className="atb-scored-time"> this turn</span></span>
              {(["player", "opponent"] as const).map(side => <span key={side} className="atb-scored-chip" data-side={side} data-scored={field.scoredBy.includes(side)} data-scoring-result={scoringTeaching && !scoringTeaching.pending && scoringTeaching.side === side && scoringTeaching.field.id === field.id ? scoringTeaching.result : undefined} role="img" aria-label={`${side === "player" ? "You have" : "The guide has"} ${field.scoredBy.includes(side) ? "already scored" : "not scored"} ${field.name} this turn`}><span aria-hidden="true">{side === "player" ? "You" : "Guide"} <b>{field.scoredBy.includes(side) ? "✓" : "—"}</b></span></span>)}
            </div>}
          </div>
        </section>)}
      </div>
      {!exploration && <div className="atb-turn-actions">
        {expected?.type === "ready" && <button type="button" data-turn-phase="awaken" {...guideProps("ready")} onClick={() => emit({ type: "ready" })} disabled={!canAct}>Awaken · ready all</button>}
        {expected?.type === "check-beginning" && <button type="button" data-turn-phase="beginning" {...guideProps("check-beginning")} onClick={() => emit({ type: "check-beginning" })} disabled={!canAct}>Check Beginning</button>}
        {expected?.type === "channel" && <button type="button" data-turn-phase="channel" {...guideProps("channel")} onClick={() => emit({ type: "channel", ready: expected.ready })} disabled={!canAct}>{expected.ready ? "Channel ready runes" : "Channel exhausted runes"}</button>}
        {expected?.type === "draw" && <button type="button" data-turn-phase="draw" {...guideProps("draw")} onClick={() => emit({ type: "draw" })} disabled={!canAct}>Draw 1 card</button>}
        <button type="button" className="atb-switch-seat" disabled title="The opponent is scripted during lessons">SWITCH SEAT</button>
        <button type="button" {...guideProps("end-turn")} onClick={() => emit({ type: "end-turn" })} disabled={!canAct}>END TURN<ArrowRight aria-hidden="true" /></button>
      </div>}
      {isMulligan && <div className="atb-mulligan-confirm"><span>Choose which cards to send back</span><button type="button" onClick={() => emit({ type: "mulligan", cardIds: mulliganIds })} disabled={!canAct}>{mulliganIds.length ? `Return ${mulliganIds.length}` : "Keep hand"}</button></div>}
      {target && <div className="atb-target-prompt" role="status">{target.type === "hide" ? "Select a battlefield for this hidden card" : target.type === "place" ? "Select the battlefield to play this card" : "Select the card to target"}<button type="button" onClick={() => setTarget(null)}>Cancel</button></div>}
    </div>
    <aside className="atb-sidebar" data-preview={Boolean(readerImage)} aria-label="Card reader, chain and table controls">
      <header><div><strong>{exploration ? "Board tour" : board.practice?.mode === "deck-check" ? "Before game" : `Turn ${board.turn}`}</strong><span>{exploration ? "Inspect freely" : board.practice?.mode === "deck-check" ? "Deck check" : board.turnPlayer === "player" ? "Your turn" : `${board.players.opponent.name}'s turn`}</span></div>{!exploration && <div className="atb-tools"><button type="button" onClick={onUndo} disabled={!onUndo || !state.history.length} aria-label="Rewind last action (R)"><RotateCcw /></button>{canFullscreen && <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen table"}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</button>}</div>}<small>{exploration ? "No game actions or progress changes" : board.practice?.mode === "deck-check" ? "Check your draft before playing" : `${board.phase} · ${board.priority === "player" ? `You have ${board.chain.length ? "priority" : board.phase.toLowerCase().includes("showdown") ? "focus" : "the next move"}` : board.priority === "opponent" ? `${board.players.opponent.name} has ${board.chain.length ? "priority" : board.phase.toLowerCase().includes("showdown") ? "focus" : "the next move"}` : board.chain.length ? "Ready to resolve" : "No response pending"}`}</small></header>
      <div className="atb-log" ref={logRef} aria-label="Game log" role="log">{board.log.slice(-7).map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>
      <section className="atb-chain" data-guide-acting={autoFocus("chain")} aria-label="Chain"><small>CHAIN{activeChain ? ` · ${board.chain.length}` : ""}</small>{!exploration && <button className="atb-resolve" type="button" {...guideProps("resolve")} disabled={!canAct || (!board.chain.length && expected?.type !== "resolve")} onClick={() => emit({ type: "resolve" })}>Resolve <kbd>S</kbd></button>}
        {groupMove && <div className="atb-group-move" role="group" aria-label="Move units together"><strong aria-live="polite">{selectedGroupIds.length} {selectedGroupIds.length === 1 ? "unit" : "units"} selected</strong><p>Select the units you want to send, then choose one battlefield for the whole group. Select a unit again if you want to leave it behind.</p><button type="button" disabled={!canAct || !selectedGroupIds.length} onClick={() => setSelectedGroupIds([])}>Clear selection</button></div>}
        {board.chain.length > 0 && <ol className="atb-chain-items" aria-label="Waiting chain items, newest first">{[...board.chain].reverse().map(renderChainItem)}</ol>}
        {chainPass && <button type="button" className="atb-approve" {...guideProps("pass")} onClick={() => emit({ type: "pass" })}>{passLabel} <kbd>W</kbd></button>}
      </section>
      {step?.decision && !exploration && <section className="atb-decision" aria-labelledby="atb-decision-title" {...guideProps("decision")}><small>YOUR CHOICE</small><h3 id="atb-decision-title">{step.decision.prompt}</h3><div>{step.decision.options.map(option => <button type="button" key={option.id} data-decision-option={option.id} disabled={!canAct} onClick={() => emit({ type: "choose", optionId: option.id })}>{option.label}</button>)}</div><p>If you want to try the other choice, use Back. Your place is saved as you go.</p>{state.feedback && <p role="status">{state.feedback}</p>}</section>}
      <section className="atb-inspection" aria-label="Card preview" data-teaching-context={showPaymentTeaching ? "payment" : showScoringTeaching ? "scoring" : undefined}><div className="atb-reader-heading"><small>CARD READER</small><button ref={readerExpandButton} type="button" disabled={!readerImage} aria-label={readerImage ? `Enlarge ${readerImage.name}` : "Enlarge card"} onClick={() => setEnlargedReader(readerImage)}><Maximize2 />Enlarge</button></div>
        {showPaymentTeaching && <section className="atb-payment-guide" aria-label={`Paying for ${paymentTeaching.card.name}`}>
          <header><small>PRINTED COST</small><strong>{paymentTeaching.card.name}</strong></header>
          <div className="atb-cost-symbols"><span><b className="atb-energy-symbol">{paymentTeaching.card.energyCost}</b> energy</span>{paymentTeaching.card.powerCost > 0 && <><i>+</i><span>{paymentTeaching.printedPowerRune && <img src={resolveCardArtwork(paymentTeaching.printedPowerRune.cardId, paymentTeaching.printedPowerRune.imageUrl)} alt="" />}<b>{paymentTeaching.card.powerCost}</b> {paymentTeaching.card.domain} power</span></>}</div>
          {paymentTeaching.alteredCost && <p className="atb-cost-change">{paymentTeaching.hidden ? "From hiding: play without paying the printed cost." : `This play: ${paymentTeaching.energy} energy${paymentTeaching.power.map(item => ` + ${item.amount} ${item.domain} power`).join("")}. A card effect changes what you pay here.`}</p>}
          <small className="atb-payment-label">AVAILABLE / NEEDED</small><div className="atb-payment-pools" aria-label="Resources available to spend"><span data-ready={paymentTeaching.availableEnergy >= paymentTeaching.energy}><b>{paymentTeaching.availableEnergy}</b> / {paymentTeaching.energy} energy</span>{paymentTeaching.power.map(item => <span key={item.domain} data-ready={item.available >= item.amount}><b>{item.available}</b> / {item.amount} {item.domain}</span>)}</div>
        </section>}
        {showScoringTeaching && <section className="atb-scoring-guide" data-result={scoringTeaching.result} aria-label={`${scoringTeaching.pending ? "Next score" : "Scoring result"}: ${scoringTeaching.field.name}`}><header><small>{scoringTeaching.pending ? "NEXT SCORE" : "WHAT CHANGED"}</small><strong>{scoringTeaching.field.name}</strong></header><ol><li><small>CONTROL</small><strong>{scoringTeaching.method === "regain" ? "Regained" : scoringTeaching.method === "hold" ? "Holding" : "Conquering"}</strong></li><li><small>{scoringTeaching.side === "player" ? "YOUR" : "GUIDE’S"} SCORE THIS TURN</small><strong>{scoringTeaching.alreadyScored ? "Already used" : scoringTeaching.pending ? "Not used yet" : "Now used ✓"}</strong></li><li><small>{scoringTeaching.pending ? "RESULT" : "SCORE"}</small><strong>{scoringTeaching.result === "point" ? `${scoringTeaching.beforeScore} → ${scoringTeaching.afterScore}` : scoringTeaching.result === "draw" ? "Draw 1" : "No point"}</strong></li></ol><p>{scoringTeaching.result === "point" ? "+1 point. Each player can score this battlefield once per turn." : scoringTeaching.result === "draw" ? "At 7, this conquer draws a card instead. It still uses this turn’s score for this battlefield." : "You already scored here this turn. Regaining control gives no point and is not another conquer."}</p></section>}
        {previewCard ? <div className="atb-preview" data-preview-card-id={previewCard.instanceId} tabIndex={0} role={target && previewCard.zone === "chain" || expected?.type === "inspect" ? "button" : undefined} aria-label={`${target && previewCard.zone === "chain" ? "Target" : "Inspect"} ${previewCard.name}`} onClick={() => { if (target && previewCard.zone === "chain" || expected?.type === "inspect") selectCard(previewCard); }} onKeyDown={event => { if ((target && previewCard.zone === "chain" || expected?.type === "inspect") && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); selectCard(previewCard); } }}>{previewCard.type === "unit" && (previewCard.mightModifiers?.length || previewCard.damage || previewCard.buffCount) ? <div className="atb-unit-values" aria-label="Current unit values"><strong>{previewCard.might} Might · {previewCard.damage} damage</strong><span>Printed Might: {previewCard.baseMight}</span>{previewCard.mightModifiers?.map((modifier, index) => <span key={`${modifier.label}:${index}`}>{modifier.label}: {modifier.amount > 0 ? "+" : ""}{modifier.amount}</span>)}</div> : null}<img src={resolveCardArtwork(previewCard.cardId, previewCard.imageUrl)} alt={previewCard.name} /><strong>{previewCard.name}</strong><p>{previewCard.rulesText}</p>{previewCard.annotation && <p className="atb-preview-annotation">{previewCard.annotation}</p>}</div> : previewBattlefield ? <div className="atb-preview atb-preview-battlefield"><BattlefieldArtwork cardId={previewBattlefield.cardId} imageUrl={previewBattlefield.imageUrl} name={previewBattlefield.name} /><strong>{previewBattlefield.name}</strong>{chainBattlefield?.cardId === previewBattlefield.cardId && <p>{activeChain?.label}</p>}</div> : <div className="atb-inspect-empty"><Eye /><strong>Take a closer look</strong><span>Hover over a card or focus it with your keyboard.<br />Reading won’t move the lesson on.</span></div>}
      </section>
      {!exploration && <section className="atb-accessible-actions" aria-label="Card and table actions">
        <button type="button" className="atb-visible-card-actions" disabled={!previewCard || previewCard.faceDown && previewCard.owner === "opponent"} onClick={() => { if (previewCard) openMenu(previewCard); }}><MoreHorizontal /><span>Card actions<strong>{previewCard?.faceDown && previewCard.owner === "opponent" ? "Face-down card" : previewCard?.name ?? "Hover or focus a card first"}</strong></span></button>
        <details className="atb-table-action-list"><summary>Table actions · no shortcuts needed</summary><div><button type="button" disabled={!canAct} onClick={() => emit({ type: "draw" })}>Draw a card</button><button type="button" disabled={!canAct} onClick={() => emit({ type: "channel", ready: true })}>Channel ready runes</button><button type="button" onClick={() => setPile({ side: "player", zone: "deck" })}>Look at my deck</button><button type="button" onClick={() => setPile({ side: "player", zone: "trash" })}>Look at my trash</button></div></details>
        <footer className="atb-sidebar-actions"><button type="button" onClick={() => setHelpOpen(true)}><HelpCircle /> Controls</button></footer>
      </section>}
    </aside></>}
    {setupTable && setupTray()}
    {enlargedReader && <dialog ref={readerDialog} className="atb-reader-expanded" aria-label={`Read ${enlargedReader.name}`} data-landscape={enlargedReader.landscape} onCancel={event => { event.preventDefault(); closeReader(); }} onKeyDown={event => event.stopPropagation()}><header><div><small>CARD READER</small><strong>{enlargedReader.name}</strong></div><button autoFocus type="button" onClick={closeReader}>Close <kbd>Esc</kbd></button></header><div>{enlargedReader.landscape ? <BattlefieldArtwork cardId={enlargedReader.cardId} imageUrl={enlargedReader.imageUrl} name={enlargedReader.name} /> : <img src={resolveCardArtwork(enlargedReader.cardId, enlargedReader.imageUrl)} alt={enlargedReader.name} />}</div><p>Take your time. Reading a card won’t advance the lesson.</p></dialog>}
    {guide && cuePosition && !lessonIntro && !mulliganIntro && !turnStart && !keywordIntro && <span className="atb-guide-cue" aria-hidden="true" style={cuePosition}>{guide.label}</span>}
    {inspectorRect && hoverPreview && <div className="atb-card-inspector" data-preview-card={hoverPreview.cardId} data-landscape={hoverPreview.landscape || undefined} aria-hidden="true" style={inspectorRect}>{hoverPreview.landscape ? <BattlefieldArtwork cardId={hoverPreview.cardId} imageUrl={hoverPreview.imageUrl} name="" /> : <img src={resolveCardArtwork(hoverPreview.cardId, hoverPreview.imageUrl)} alt="" />}</div>}
    {effectArrows.length > 0 && <svg className="atb-effect-arrows" aria-hidden="true"><defs><marker id="atb-effect-head" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8Z" fill="#e9be78" /></marker></defs>{effectArrows.map(arrow => <path key={arrow.key} d={arrow.path} markerEnd="url(#atb-effect-head)" />)}</svg>}
    {effectBadges.map(badge => <div key={badge.key} className="atb-effect-callout" data-kind={badge.kind} style={{ left: badge.left, top: badge.top, width: badge.width }}><small>{badge.label}</small>{badge.base !== undefined && badge.current !== undefined ? <div className="atb-might-formula"><span><b>{badge.base}</b><em>printed</em></span><i>{badge.current - badge.base >= 0 ? '+' : '−'}{Math.abs(badge.current - badge.base)}</i><ArrowRight /><span><strong>{badge.current}</strong><em>now</em></span></div> : <div className="atb-effect-values"><span>{badge.before}</span><ArrowRight /><strong>{badge.after}</strong></div>}</div>)}
    {flights.map(flight => <FlyingCard key={flight.id} flight={flight} onDone={() => setFlights(current => current.filter(item => item.id !== flight.id))} />)}
    {targetPath && <svg className="atb-target-arrow" viewBox="0 0 1800 1000" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="atb-target-tip" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8" fill="none" stroke="#a6f1ef" strokeWidth="1.5" /></marker></defs><path d={targetPath} fill="none" stroke="#3d9aab" strokeWidth="5" opacity=".55" /><path d={targetPath} fill="none" stroke="#a6f1ef" strokeWidth="2" markerEnd="url(#atb-target-tip)" /></svg>}
    {menu && menuCard && <><button type="button" className="atb-dismiss" aria-label="Close card actions" onClick={() => setMenu(null)} /><div className="atb-card-menu" ref={menuRef} role="menu" aria-label={`${menuCard.name} actions`} style={{ left: `${menu.left}%`, top: `${menu.top}%` }} onKeyDown={event => { if (event.key === "Escape") { setMenu(null); root.current?.focus(); } }}>
      <strong>{menuCard.name}</strong>
      {expected?.type === "choose-trigger" && <button type="button" role="menuitem" onClick={() => { emit({ type: "choose-trigger", cardId: expected.cardId, targetId: menuCard.instanceId }); setMenu(null); }}>Choose as ability target<small>Click the card, or focus it and press Enter</small></button>}
      <button type="button" role="menuitem" onClick={() => { if (expected?.type === "inspect") emit({ type: "inspect", cardId: menuCard.instanceId }); else setReadCardId(menuCard.instanceId); setMenu(null); }}><Eye /> {expected?.type === "inspect" ? "I’ve read this card" : "Show card details"}</button>
      {menuCard.owner === "player" && <>
        {expected?.type === "activate" && expected.cardId === menuCard.instanceId && <button type="button" role="menuitem" {...guideProps("menu:activate")} onClick={() => activateCard(menuCard)}>Activate ability{expected.targetId ? " · choose target" : ""}<small>Shift + click / Shift + Enter</small></button>}
        {menuCard.type === "rune" && <><button type="button" role="menuitem" disabled={!menuCard.ready} onClick={() => { emit({ type: "exhaust", cardId: menuCard.instanceId }); setMenu(null); }}><Zap /> Exhaust for energy</button><button type="button" role="menuitem" {...guideProps("menu:recycle")} onClick={() => { emit({ type: "recycle", cardId: menuCard.instanceId }); setMenu(null); }}>Recycle for {menuCard.domain} power</button></>}
        {["hand", "champion", "hidden"].includes(menuCard.zone) && menuCard.type !== "rune" && <button type="button" role="menuitem" onClick={() => playCard(menuCard)}>{menuCard.type === "spell" ? "Play spell" : "Play unit or gear"}<small>{menuCard.energyCost} energy{menuCard.powerCost ? ` + ${menuCard.powerCost} ${menuCard.domain}` : ""}</small></button>}
        {menuCard.keywords.some(word => word.toLowerCase() === "hidden") && menuCard.zone === "hand" && <button type="button" role="menuitem" onClick={() => { setTarget({ type: "hide", cardId: menuCard.instanceId }); setMenu(null); }}>Hide at a battlefield…</button>}
        {menuCard.type === "unit" && !["hand", "champion", "legend", "trash"].includes(menuCard.zone) && (["base", "battlefield-left", "battlefield-right"] as TutorialZone[]).filter(zone => zone !== menuCard.zone).map(zone => <button type="button" role="menuitem" key={zone} onClick={() => sendCard(menuCard, zone)}>Move to {ZONE_LABELS[zone]}</button>)}
      </>}
      <button type="button" role="menuitem" onClick={() => setMenu(null)}>Close</button>
    </div></>}
    {(showDamage || combatDemo) && <section className="atb-combat-demo" aria-label="Guided combat demonstration" data-assigned={Boolean(combatDemo)} data-animate={combatDemo?.animate ?? false}><small>THIS GUIDED GAME ASSIGNS FOR YOU</small><strong>{combatDemo ? combatDamageDealt ? "Combat damage has been dealt" : "Assignments shown on the cards" : "Watch the combat damage"}</strong><p>{combatDamageDealt ? "Both sides dealt their damage together, so check each unit’s damage against its current Might. If it took that much or more it died, and the survivors keep their marked damage until combat cleanup." : (combatDemo?.data ?? step?.combatDemonstration)?.explanation}</p>{combatDemo ? <ol>{combatDemo.data.targetAssignments.map(entry => <li key={entry.cardId} style={{ "--assignment-delay": `${(entry.order - 1) * 650}ms` } as React.CSSProperties}><b>{entry.order}</b><span>{entry.label ?? `${entry.amount} damage assigned to ${cardById(entry.cardId)?.name ?? "unit"}`}</span></li>)}</ol> : <button type="button" {...guideProps("demonstrate-combat")} disabled={!canAct} onClick={() => { pendingDemo.current = step?.combatDemonstration; pendingDemoActionCount.current = state.actions.length; emit({ type: "demonstrate-combat" }); }}>Show the damage<ArrowRight /></button>}<span>{combatDemo ? combatDamageDealt ? "Both sides dealt their damage together. Check the surviving units before cleanup." : expected?.type === "resolve" ? "Now resolve: both sides deal their damage at the same time." : "Assignment shown. Combat damage has not been dealt yet." : "In a real game, choose legal assignments before dealing damage."}</span></section>}
    {pile && <div ref={pileRef} className="atb-pile-dialog" role="dialog" aria-label={`${board.players[pile.side].name}'s ${pile.zone === "deck" ? "main deck" : pile.zone}`}><header><strong>{board.players[pile.side].name}'s {pile.zone === "deck" ? "main deck" : pile.zone}</strong><button type="button" onClick={closePile}>Close</button></header>{pile.zone === "deck" && deckDetails(pile.side)}{board.practice?.mode === "deck-check" && <p className="atb-deck-check-note">Before the game · inspect the highlighted duplicate in this deck draft. This is a deckbuilding check.</p>}{pile.zone === "deck" && board.practice?.mode !== "deck-check" && <p className="atb-deck-check-note">Cards relevant to this teaching example are shown here. The deck count includes the remaining cards.</p>}<div>{cardsIn(pile.side, pile.zone).length ? cardsIn(pile.side, pile.zone).map(card => <div className="atb-pile-card" key={card.instanceId}>{cardView(card)}<strong>{card.faceDown && card.owner === "opponent" ? "Face-down card" : card.name}</strong>{card.annotation && <small>{card.annotation}</small>}{expected?.type === "predict" && expected.cardId === card.instanceId && <div className="atb-predict-controls"><span>Predict · your private choice</span>{(["keep", "recycle"] as const).map(choice => <button key={choice} type="button" {...guideProps(`predict:${choice}`)} disabled={!canAct} onClick={() => emit({ type: "predict", cardId: card.instanceId, choice })}>{choice === "keep" ? "Keep on top" : "Recycle to bottom"}</button>)}</div>}{board.practice?.mode === "deck-check" && expected?.type === "remove-draft-copy" && expected.cardId === card.instanceId && <button type="button" className="atb-remove-draft" {...guideProps(`remove-draft:${card.instanceId}`)} disabled={!canAct} onClick={() => emit({ type: "remove-draft-copy", cardId: card.instanceId })}>Remove duplicate</button>}</div>) : <p>No cards here yet.</p>}</div></div>}
    {helpOpen && <div className="atb-help-dialog" role="dialog" aria-label="Table controls"><header><strong>Controls</strong><button type="button" onClick={() => setHelpOpen(false)}>Close</button></header><dl><dt>Hover / focus</dt><dd>Read a card without advancing. Click it, or press Enter, when the guide asks you to confirm.</dd><dt>Tap or click a hand card</dt><dd>Play; select a target when prompted</dd><dt>Tap or click a ready rune</dt><dd>Turn it sideways to make 1 energy</dd><dt>Right-click rune / Shift + F10</dt><dd>Recycle for power in this guided game. An exhausted rune gives power; it does not make energy again.</dd><dt>Drag unit</dt><dd>Move to a battlefield or base</dd><dt>Shift + click / Shift + Enter</dt><dd>Activate the highlighted ability</dd><dt>Right-click main deck</dt><dd>Inspect the cards used in this example</dd><dt>Ctrl + rune deck</dt><dd>Bring runes from the rune deck onto the table, ready to use</dd><dt>D</dt><dd>Draw a card</dd><dt>W / A</dt><dd>Pass focus in an open showdown / pass priority on a waiting chain</dd><dt>S</dt><dd>Carry out the next waiting effect, or deal combat damage</dd><dt>Q</dt><dd>Conquer / score</dd><dt>Space</dt><dd>End turn (table focused)</dd><dt>R</dt><dd>Rewind accepted action</dd></dl><p>Follow the current lesson. Other actions leave this teaching position unchanged.</p></div>}
  </div>;
}

function BattlefieldArtwork({ cardId, imageUrl, name }: { cardId: string; imageUrl: string; name: string }) {
  const [portrait, setPortrait] = useState(false);
  return <span className="atb-battlefield-art" data-portrait={portrait}><img src={resolveCardArtwork(cardId, imageUrl)} alt={name} onLoad={event => setPortrait(event.currentTarget.naturalHeight > event.currentTarget.naturalWidth)} /></span>;
}

function FlyingCard({ flight, onDone }: { flight: CardFlight; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone); done.current = onDone;
  useLayoutEffect(() => {
    const frame = (rect: CardRect) => ({ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const animation = ref.current?.animate([
      { ...frame(flight.from), opacity: .88 }, { ...frame(flight.to), opacity: 1 }
    ], { duration: 360, easing: "cubic-bezier(.2,.75,.2,1)", fill: "forwards" });
    if (animation) animation.onfinish = () => done.current();
    else done.current();
    return () => { if (animation) { animation.onfinish = null; animation.cancel(); } };
  }, [flight]);
  return <div className="atb-card-flight" ref={ref} style={flight.from} aria-hidden="true"><img src={flight.image} alt="" /></div>;
}



