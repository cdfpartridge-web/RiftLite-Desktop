import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Flag, GripVertical } from "lucide-react";
import { useOwnedPointerGesture } from "./useOwnedPointerGesture";
import { DEFAULT_MARKER_POSITION, LIVE_DECISION_MARKER_POSITION_KEY, markerPixels, markerPositionAt, parseMarkerPosition, type MarkerBounds, type MarkerPosition } from "./liveDecisionMarkerPosition";

export function LiveDecisionMarker({ onMark, hotkey }: { onMark: () => void; hotkey?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<MarkerPosition>(() => {
    try { return parseMarkerPosition(window.localStorage.getItem(LIVE_DECISION_MARKER_POSITION_KEY)); }
    catch { return { ...DEFAULT_MARKER_POSITION }; }
  });
  const positionRef = useRef(position);
  const [bounds, setBounds] = useState<MarkerBounds | null>(null);
  const boundsRef = useRef(bounds);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; origin: MarkerPosition; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const { start, cancel } = useOwnedPointerGesture();

  function update(next: MarkerPosition, persist = false) {
    positionRef.current = next;
    setPosition(next);
    if (persist) {
      try { window.localStorage.setItem(LIVE_DECISION_MARKER_POSITION_KEY, JSON.stringify(next)); }
      catch { /* Positioning still works when local preferences cannot be written. */ }
    }
  }

  useLayoutEffect(() => {
    const element = button.current, frame = element?.parentElement;
    if (!element || !frame) return;
    const measure = () => {
      if (!frame.clientWidth || !frame.clientHeight) return;
      const next = { width: frame.clientWidth, height: frame.clientHeight, buttonWidth: element.offsetWidth, buttonHeight: element.offsetHeight };
      boundsRef.current = next;
      setBounds(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("blur", cancel); cancel(); };
  }, [cancel]);

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary || !boundsRef.current) return;
    cancel();
    event.stopPropagation();
    suppressClick.current = false;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: positionRef.current, moved: false };
    const cancelDrag = () => {
      const current = drag.current;
      drag.current = null;
      suppressClick.current = true;
      setDragging(false);
      if (current) update(current.origin);
    };
    start({ target: event.currentTarget, pointerId: event.pointerId,
      onMove: (move) => {
        const current = drag.current, area = boundsRef.current;
        if (!current || !area) return;
        const dx = move.clientX - current.startX, dy = move.clientY - current.startY;
        if (!current.moved && Math.hypot(dx, dy) < 6) return;
        current.moved = true;
        suppressClick.current = true;
        move.preventDefault();
        setDragging(true);
        const origin = markerPixels(current.origin, area);
        update(markerPositionAt({ x: origin.x + dx, y: origin.y + dy }, area));
      },
      onEnd: (end) => {
        if (end.type === "pointercancel") { cancelDrag(); return; }
        const current = drag.current;
        drag.current = null;
        setDragging(false);
        if (current?.moved) update(positionRef.current, true);
      },
      onCancel: cancelDrag
    });
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    const area = boundsRef.current;
    if (!area || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
    if (event.key === "Home") { update({ ...DEFAULT_MARKER_POSITION }, true); return; }
    const pixels = markerPixels(positionRef.current, area), distance = event.shiftKey ? 40 : 10;
    update(markerPositionAt({ x: pixels.x + (event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0), y: pixels.y + (event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0) }, area), true);
  }

  const pixels = bounds ? markerPixels(position, bounds) : null;
  return <>
    {dragging && <div className="enhanced-insights-marker-drag-shield" aria-hidden="true" />}
    <button ref={button} type="button" className="enhanced-insights-live-marker" data-dragging={dragging}
      style={pixels ? { left: pixels.x, top: pixels.y, right: "auto" } : undefined}
      onPointerDown={startDrag} onKeyDown={moveWithKeyboard}
      onClick={(event) => {
        if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); return; }
        onMark();
      }}
      title={`Click to mark this decision${hotkey ? ` (${hotkey})` : ""}. Drag to move. Arrow keys reposition; Home resets the position.`}
      aria-label="Mark decision" aria-description="Drag to reposition, or use arrow keys while focused. Home resets the position. Enter or Space marks the decision.">
      <GripVertical size={13} className="enhanced-insights-marker-grip" aria-hidden="true" />
      <Flag size={15} aria-hidden="true" />Mark decision
    </button>
  </>;
}
