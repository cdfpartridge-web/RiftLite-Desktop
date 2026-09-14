export type MarkerPosition = { x: number; y: number };
export type MarkerBounds = { width: number; height: number; buttonWidth: number; buttonHeight: number };
export const LIVE_DECISION_MARKER_POSITION_KEY = "riftlite.live-decision-marker-position.v1";
export const DEFAULT_MARKER_POSITION: MarkerPosition = { x: 1, y: 0 };

export function parseMarkerPosition(raw: string | null): MarkerPosition {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (value && typeof value === "object" && "x" in value && "y" in value
      && typeof value.x === "number" && Number.isFinite(value.x)
      && typeof value.y === "number" && Number.isFinite(value.y)) {
      return { x: Math.max(0, Math.min(1, value.x)), y: Math.max(0, Math.min(1, value.y)) };
    }
  } catch { /* A damaged preference should never hide the marker. */ }
  return { ...DEFAULT_MARKER_POSITION };
}

function axis(frame: number, button: number) {
  const space = Math.max(0, frame - button);
  const inset = Math.min(12, space / 2);
  return { inset, travel: Math.max(0, space - inset * 2) };
}

export function markerPixels(position: MarkerPosition, bounds: MarkerBounds): MarkerPosition {
  const horizontal = axis(bounds.width, bounds.buttonWidth), vertical = axis(bounds.height, bounds.buttonHeight);
  return { x: horizontal.inset + position.x * horizontal.travel, y: vertical.inset + position.y * vertical.travel };
}

export function markerPositionAt(pixels: MarkerPosition, bounds: MarkerBounds): MarkerPosition {
  const horizontal = axis(bounds.width, bounds.buttonWidth), vertical = axis(bounds.height, bounds.buttonHeight);
  return {
    x: horizontal.travel ? Math.max(0, Math.min(1, (pixels.x - horizontal.inset) / horizontal.travel)) : 1,
    y: vertical.travel ? Math.max(0, Math.min(1, (pixels.y - vertical.inset) / vertical.travel)) : 0
  };
}
