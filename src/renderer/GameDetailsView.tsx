import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, BookOpen, Film, FileText, List } from "lucide-react";
import type { GameDetailsTab } from "../shared/gameDetails";
import "./styles/game-details.css";

export interface GameDetailsViewProps {
  title: string;
  subtitle?: string;
  tab: GameDetailsTab;
  onTabChange: (tab: GameDetailsTab) => void;
  onClose: () => void;
  panels: Record<GameDetailsTab, ReactNode>;
  actions?: ReactNode;
  notice?: ReactNode;
  overlays?: ReactNode;
}

/** One modal over the originating page: its filters, scroll and selection stay mounted. */
export function GameDetailsView({ title, subtitle, tab, onTabChange, onClose, panels, actions, notice, overlays }: GameDetailsViewProps) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const panelId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>("button")?.focus());
    const controlsIn = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])'))
      .filter((item) => item.getClientRects().length > 0 && !item.closest("[hidden]") && item.tabIndex !== -1);
    function outerLayer(item: HTMLElement) {
      if (item.matches("dialog[open]")) return Number.MAX_SAFE_INTEGER;
      let layer: HTMLElement | null = item, value = 0;
      while (layer && layer !== document.body) {
        const z = Number(window.getComputedStyle(layer).zIndex);
        if (Number.isFinite(z) && z) value = z;
        layer = layer.parentElement;
      }
      return value;
    }
    function topDialog() {
      const element = dialog.current;
      if (!element) return null;
      return Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [role="alertdialog"]'))
        .filter((item) => item.getClientRects().length > 0 && (item === element || element.contains(item) || outerLayer(item) > 350))
        .sort((a, b) => outerLayer(a) - outerLayer(b)).at(-1) ?? element;
    }
    let focusedChild: HTMLElement | null = null;
    let childOpener: HTMLElement | null = null;
    const observer = new MutationObserver(() => {
      const next = topDialog();
      const child = next && next !== dialog.current && !next.matches("dialog[open]") ? next : null;
      if (child === focusedChild) return;
      if (child) {
        childOpener = document.activeElement instanceof HTMLElement && !child.contains(document.activeElement) ? document.activeElement : null;
        if (!child.contains(document.activeElement)) controlsIn(child)[0]?.focus();
      } else if (focusedChild && childOpener?.isConnected) childOpener.focus({ preventScroll: true });
      focusedChild = child;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    function onKeyDown(event: KeyboardEvent) {
      const element = topDialog();
      if (!element || event.defaultPrevented) return;
      // Native log/player dialogs retain the browser's top-layer handling.
      if (element.matches("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (element === dialog.current) closeRef.current();
        else {
          const close = controlsIn(element).find((item) => item.tagName === "BUTTON" && (/^close/i.test(item.getAttribute("aria-label") || item.getAttribute("title") || "") || /^(cancel|done|back)$/i.test(item.textContent?.trim() || "")));
          close?.click();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const controls = controlsIn(element);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); element.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      // A child portal can restore the "hidden" value it saw on opening after
      // this parent unmounts. Restore once those cleanups finish, unless another
      // dialog (such as Edit match) has taken over the scroll lock.
      queueMicrotask(() => {
        if (!document.querySelector('.game-details-backdrop, .modal-backdrop, dialog[open], [role="dialog"], [role="alertdialog"]')) document.body.style.overflow = previousOverflow;
      });
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const tabs = [
    ["summary", "Summary", List], ["media", "Replay & video", Film],
    ["decks", "Decks", BookOpen], ["notes", "Notes", FileText]
  ] as const;
  return createPortal(<div className="game-details-backdrop"><section ref={dialog} className="game-details-dialog review-replays" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <header className="game-details-heading">
      <button type="button" className="secondary game-details-back" onClick={onClose}><ArrowLeft size={16} />Back</button>
      <div><span className="review-kicker">Game details</span><h2 id={titleId}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
      {actions ? <div className="game-details-actions">{actions}</div> : null}
    </header>
    {notice ? <div className="game-details-notice">{notice}</div> : null}
    <nav className="game-details-tabs" aria-label="Game details" role="tablist">
      {tabs.map(([id, label, Icon], index) => <button type="button" key={id} role="tab" id={`${panelId}-tab-${id}`}
        aria-selected={tab === id} aria-controls={`${panelId}-${id}`} tabIndex={tab === id ? 0 : -1}
        onClick={() => onTabChange(id)} onKeyDown={(event) => {
          const nextIndex = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
          if (nextIndex >= 0) { event.preventDefault(); onTabChange(tabs[nextIndex][0]); document.getElementById(`${panelId}-tab-${tabs[nextIndex][0]}`)?.focus(); }
        }}><Icon size={16} />{label}</button>)}
    </nav>
    <div className="game-details-body">
      {tabs.map(([id]) => <section key={id} id={`${panelId}-${id}`} role="tabpanel" aria-labelledby={`${panelId}-tab-${id}`} hidden={tab !== id} tabIndex={0}>{panels[id]}</section>)}
    </div>
    {overlays}
  </section></div>, document.body);
}
