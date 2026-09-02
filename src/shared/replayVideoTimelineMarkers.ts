import type { ReplaySide } from "./atlasReplay.js";
import type { ReplayIntelligenceEvent } from "./replayIntelligence.js";

export type ReplayVideoTimelineMarkerSide = "player" | "opponent" | "neutral";

export const REPLAY_VIDEO_TIMELINE_MARKERS_STORAGE_KEY = "riftlite-replay-video-timeline-markers-v1";

export interface ReplayVideoTimelineMarkerPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ReplayVideoTimelineMarker {
  event: ReplayIntelligenceEvent;
  side: ReplayVideoTimelineMarkerSide;
  isScore: boolean;
  scoreLabel: string;
  scoreDelta?: number;
  accessibleLabel: string;
}

const MARKER_EVENT_TYPES = new Set<ReplayIntelligenceEvent["type"]>([
  "mulligan",
  "play",
  "combat",
  "score",
  "scoreboard",
  "battlefield",
  "result"
]);
const MARKER_DEDUPE_WINDOW_MS = 1_500;
const SCORE_COMPANION_EXACT_TIME_MS = 250;
const DEFAULT_MARKER_LIMIT = 80;

type CompleteScore = { me: number; opponent: number };
type ScoreDelta = { side: "player" | "opponent"; points: number };
type ScoreCompanion = { score: CompleteScore; inferredDelta?: ScoreDelta };

export function readReplayVideoTimelineMarkersEnabled(
  storage: ReplayVideoTimelineMarkerPreferenceStorage | null | undefined
): boolean {
  try {
    return storage?.getItem(REPLAY_VIDEO_TIMELINE_MARKERS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeReplayVideoTimelineMarkersEnabled(
  storage: ReplayVideoTimelineMarkerPreferenceStorage | null | undefined,
  enabled: boolean
): void {
  try {
    storage?.setItem(REPLAY_VIDEO_TIMELINE_MARKERS_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // This is a device-local viewing preference; the current view still updates.
  }
}

export function replayVideoTimelineMarkers(
  events: ReplayIntelligenceEvent[],
  limit = DEFAULT_MARKER_LIMIT
): ReplayVideoTimelineMarker[] {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => (
      event.confidence !== "inferred" &&
      Number.isFinite(event.videoTimeMs) &&
      MARKER_EVENT_TYPES.has(event.type)
    ))
    .sort((left, right) => (
      (left.event.videoTimeMs ?? 0) - (right.event.videoTimeMs ?? 0)
      || left.index - right.index
    ))
    .map(({ event }) => event);
  const { companionByScoreEvent, companionScoreboards } = scoreCompanions(ordered);
  const scoreByGame = new Map<number, CompleteScore>();
  const markers: ReplayVideoTimelineMarker[] = [];
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_MARKER_LIMIT;

  for (const event of ordered) {
    const isScore = event.type === "score" || event.type === "scoreboard";
    const sourceScore = completeScore(event.score);
    const gameNumber = validGameNumber(event.gameNumber);
    const priorScore = gameNumber == null ? undefined : scoreByGame.get(gameNumber);
    const sequenceDelta = isScore ? unambiguousScoreDelta(priorScore, sourceScore) : undefined;
    if (gameNumber != null) {
      if (sourceScore) {
        scoreByGame.set(gameNumber, sourceScore);
      } else if (event.score !== undefined) {
        scoreByGame.delete(gameNumber);
      }
    }
    if (event.type === "scoreboard" && companionScoreboards.has(event)) {
      continue;
    }

    const companion = companionByScoreEvent.get(event);
    const displayEvent = companion && !sourceScore
      ? { ...event, score: companion.score }
      : event;
    const inferredDelta = companion?.inferredDelta ?? sequenceDelta;
    const inferredMatchesExplicitSide = event.side === "system"
      || event.side === "unknown"
      || replayVideoTimelineMarkerSide(event.side) === inferredDelta?.side;
    const safeInferredDelta = inferredMatchesExplicitSide ? inferredDelta : undefined;
    const side = replayVideoTimelineMarkerSide(event.side, safeInferredDelta?.side);
    const explicitPoints = finiteNonZero(event.pointsScored);
    const scoreDelta = isScore ? explicitPoints ?? safeInferredDelta?.points : undefined;
    const marker: ReplayVideoTimelineMarker = {
      event: displayEvent,
      side,
      isScore,
      scoreLabel: isScore ? replayVideoTimelineScoreLabel(displayEvent, scoreDelta) : "",
      scoreDelta,
      accessibleLabel: ""
    };
    marker.accessibleLabel = replayVideoTimelineMarkerAccessibleLabel(marker);

    if (markers.some((candidate) => markerIsNearDuplicate(candidate, marker))) {
      continue;
    }
    markers.push(marker);
    if (markers.length >= safeLimit) {
      break;
    }
  }

  return markers;
}

export function replayVideoTimelineMarkerSide(
  side: ReplaySide,
  inferred?: "player" | "opponent"
): ReplayVideoTimelineMarkerSide {
  if (side === "me") return "player";
  if (side === "opponent") return "opponent";
  return inferred ?? "neutral";
}

export function replayVideoTimelineScoreLabel(
  event: Pick<ReplayIntelligenceEvent, "score" | "pointsScored">,
  scoreDelta = finiteNonZero(event.pointsScored)
): string {
  const score = completeScore(event.score);
  if (score) {
    return `${formatScoreNumber(score.me)}–${formatScoreNumber(score.opponent)}`;
  }
  if (scoreDelta != null) {
    return `${scoreDelta > 0 ? "+" : ""}${formatScoreNumber(scoreDelta)}`;
  }
  return "Score";
}

export function replayVideoTimelineMarkerAccessibleLabel(marker: ReplayVideoTimelineMarker): string {
  const { event } = marker;
  const actor = marker.side === "player"
    ? "Player"
    : marker.side === "opponent"
      ? "Opponent"
      : event.side === "system"
        ? "Game"
        : "Unattributed";
  const time = formatMarkerTime(event.videoTimeMs ?? 0);
  const confidence = `${capitalize(event.confidence)} evidence`;
  const text = event.text.trim();

  if (marker.isScore) {
    const score = completeScore(event.score);
    const delta = marker.scoreDelta == null
      ? "score update"
      : marker.scoreDelta > 0
        ? `scored ${formatScoreNumber(marker.scoreDelta)} point${Math.abs(marker.scoreDelta) === 1 ? "" : "s"}`
        : `score changed by ${formatScoreNumber(marker.scoreDelta)}`;
    const total = score ? `, total ${formatScoreNumber(score.me)}–${formatScoreNumber(score.opponent)}` : "";
    return `${actor} ${delta}${total} at ${time}.${text ? ` ${text}.` : ""} ${confidence}.`;
  }

  const eventType = event.type.replaceAll("-", " ");
  return `${actor} ${eventType} at ${time}.${text ? ` ${text}.` : ""} ${confidence}.`;
}

function markerIsNearDuplicate(
  candidate: ReplayVideoTimelineMarker,
  marker: ReplayVideoTimelineMarker
): boolean {
  const candidateGame = validGameNumber(candidate.event.gameNumber);
  const markerGame = validGameNumber(marker.event.gameNumber);
  if (candidateGame !== markerGame || candidate.event.type !== marker.event.type || candidate.side !== marker.side) {
    return false;
  }
  if (Math.abs((candidate.event.videoTimeMs ?? 0) - (marker.event.videoTimeMs ?? 0)) >= MARKER_DEDUPE_WINDOW_MS) {
    return false;
  }
  if (!marker.isScore) {
    return true;
  }
  return candidate.scoreLabel === marker.scoreLabel && candidate.scoreDelta === marker.scoreDelta;
}

function scoreCompanions(events: ReplayIntelligenceEvent[]): {
  companionByScoreEvent: Map<ReplayIntelligenceEvent, ScoreCompanion>;
  companionScoreboards: Set<ReplayIntelligenceEvent>;
} {
  const scoreboardDetails = new Map<ReplayIntelligenceEvent, ScoreCompanion>();
  const previousScoreByGame = new Map<number, CompleteScore>();

  for (const event of events) {
    if (event.type !== "scoreboard") continue;
    const score = completeScore(event.score);
    const gameNumber = validGameNumber(event.gameNumber);
    if (!score) {
      if (gameNumber != null && event.score !== undefined) previousScoreByGame.delete(gameNumber);
      continue;
    }
    const inferredDelta = gameNumber == null
      ? undefined
      : unambiguousScoreDelta(previousScoreByGame.get(gameNumber), score);
    scoreboardDetails.set(event, { score, inferredDelta });
    if (gameNumber != null) previousScoreByGame.set(gameNumber, score);
  }

  const companionByScoreEvent = new Map<ReplayIntelligenceEvent, ScoreCompanion>();
  const companionScoreboards = new Set<ReplayIntelligenceEvent>();
  for (const scoreboard of events) {
    const details = scoreboardDetails.get(scoreboard);
    if (!details) continue;
    const candidates = events
      .filter((event) => event.type === "score" && !companionByScoreEvent.has(event))
      .map((event) => ({ event, distance: Math.abs((event.videoTimeMs ?? 0) - (scoreboard.videoTimeMs ?? 0)) }))
      .filter(({ event, distance }) => scoreEventsAreCompanions(scoreboard, details, event, distance))
      .sort((left, right) => {
        const leftHasTotal = completeScore(left.event.score) ? 0 : 1;
        const rightHasTotal = completeScore(right.event.score) ? 0 : 1;
        return leftHasTotal - rightHasTotal || left.distance - right.distance;
      });
    const companion = candidates[0]?.event;
    if (!companion) continue;
    companionByScoreEvent.set(companion, details);
    companionScoreboards.add(scoreboard);
  }

  return { companionByScoreEvent, companionScoreboards };
}

function scoreEventsAreCompanions(
  scoreboard: ReplayIntelligenceEvent,
  details: ScoreCompanion,
  scoreEvent: ReplayIntelligenceEvent,
  distance: number
): boolean {
  if (validGameNumber(scoreboard.gameNumber) !== validGameNumber(scoreEvent.gameNumber)) return false;
  if (distance >= MARKER_DEDUPE_WINDOW_MS) return false;
  const explicitScore = completeScore(scoreEvent.score);
  if (explicitScore) return scoresEqual(details.score, explicitScore);
  if (distance > SCORE_COMPANION_EXACT_TIME_MS || !details.inferredDelta) return false;
  if (replayVideoTimelineMarkerSide(scoreEvent.side) !== details.inferredDelta.side) return false;
  const explicitPoints = finiteNonZero(scoreEvent.pointsScored);
  return explicitPoints == null || (explicitPoints > 0 && explicitPoints <= details.inferredDelta.points);
}

function scoresEqual(left: CompleteScore, right: CompleteScore): boolean {
  return left.me === right.me && left.opponent === right.opponent;
}

function unambiguousScoreDelta(
  previous: CompleteScore | undefined,
  next: CompleteScore | undefined
): ScoreDelta | undefined {
  if (!previous || !next) return undefined;
  const playerDelta = next.me - previous.me;
  const opponentDelta = next.opponent - previous.opponent;
  if (playerDelta > 0 && opponentDelta === 0) {
    return { side: "player", points: playerDelta };
  }
  if (opponentDelta > 0 && playerDelta === 0) {
    return { side: "opponent", points: opponentDelta };
  }
  return undefined;
}

function completeScore(value: ReplayIntelligenceEvent["score"]): CompleteScore | undefined {
  if (!value || !Number.isFinite(value.me) || !Number.isFinite(value.opponent)) {
    return undefined;
  }
  return { me: value.me!, opponent: value.opponent! };
}

function validGameNumber(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value! > 0 ? value : undefined;
}

function finiteNonZero(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value !== 0 ? value : undefined;
}

function formatScoreNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatMarkerTime(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.round(timeMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
