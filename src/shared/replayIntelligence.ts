import { buildAtlasReplay, type AtlasReplayViewModel, type ReplayTimelineEvent } from "./atlasReplay.js";
import type {
  MatchDraft,
  ReplayIntelligenceCardJourney,
  ReplayIntelligenceConfidence,
  ReplayIntelligenceCorrection,
  ReplayIntelligenceMoment,
  ReplayIntelligenceSource,
  ReplayIntelligenceSummary,
  ReplayRecord
} from "./types.js";

export interface ReplayIntelligenceEvent extends ReplayTimelineEvent {
  source: ReplayIntelligenceSource;
  confidence: ReplayIntelligenceConfidence;
  confidenceReason: string;
  videoTimeMs?: number;
  turnLabel: string;
  corrected: boolean;
  correctionNote: string;
}

export interface ReplayIntelligenceResult {
  summary: ReplayIntelligenceSummary;
  events: ReplayIntelligenceEvent[];
}

const CARD_EVENT_TYPES = new Set(["draw", "play", "move", "action"]);

export function buildReplayIntelligence(
  replay: ReplayRecord,
  model: AtlasReplayViewModel = buildAtlasReplay(replay, replay.matchSnapshot),
  corrections: ReplayIntelligenceCorrection[] = replay.intelligence?.corrections ?? []
): ReplayIntelligenceResult {
  const correctionByEvent = new Map(corrections.map((correction) => [correction.eventId, correction]));
  const turnByEvent = new Map<string, string>();
  for (const turn of model.turns) {
    for (const event of turn.events) turnByEvent.set(event.id, turn.label);
  }

  const events = model.events
    .map((event) => intelligenceEvent(replay, event, turnByEvent.get(event.id) ?? "", correctionByEvent.get(event.id)))
    .filter((event): event is ReplayIntelligenceEvent => Boolean(event))
    .sort((left, right) => eventTime(left) - eventTime(right));
  const cardJourneys = buildCardJourneys(events);
  const moments = buildMoments(events, cardJourneys);
  const stats = buildStats(events, model);
  const coverage = buildCoverage(events, replay);
  const limitations = buildLimitations(replay, events, coverage.grade);
  const story = buildStory(replay, model, events, cardJourneys, stats);

  return {
    events,
    summary: {
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceEventCount: model.events.length,
      corrections: corrections.slice(-200),
      coverage,
      stats,
      story,
      moments,
      cardJourneys: cardJourneys.slice(0, 120),
      limitations
    }
  };
}

export function replayWithIntelligence(
  replay: ReplayRecord,
  match: MatchDraft | undefined = replay.matchSnapshot,
  corrections: ReplayIntelligenceCorrection[] = replay.intelligence?.corrections ?? []
): ReplayRecord {
  const model = buildAtlasReplay(replay, match);
  return {
    ...replay,
    schemaVersion: 5,
    intelligence: buildReplayIntelligence(replay, model, corrections).summary
  };
}

function intelligenceEvent(
  replay: ReplayRecord,
  event: ReplayTimelineEvent,
  turnLabel: string,
  correction?: ReplayIntelligenceCorrection
): ReplayIntelligenceEvent | null {
  if (correction?.dismissed) return null;
  const evidence = confidenceFor(replay, event);
  const corrected = Boolean(correction);
  const next: ReplayTimelineEvent = correction ? {
    ...event,
    capturedAt: correction.capturedAt ?? event.capturedAt,
    labelTime: correction.capturedAt ? timeLabel(correction.capturedAt) : event.labelTime,
    type: correction.type ?? event.type,
    side: correction.side ?? event.side,
    text: correction.text ?? event.text,
    cardName: correction.cardName ?? event.cardName,
    cardId: correction.cardId ?? event.cardId,
    destination: correction.destination ?? event.destination,
    fromZone: correction.fromZone ?? event.fromZone,
    toZone: correction.toZone ?? event.toZone,
    battlefield: correction.battlefield ?? event.battlefield,
    pointsScored: correction.pointsScored ?? event.pointsScored
  } : event;
  return {
    ...next,
    source: corrected ? "manual" : evidence.source,
    confidence: corrected ? "manual" : evidence.confidence,
    confidenceReason: corrected ? "Reviewed and corrected manually." : evidence.reason,
    videoTimeMs: replayEventVideoTimeMs(replay, next),
    turnLabel,
    corrected,
    correctionNote: correction?.note?.trim() ?? ""
  };
}

function confidenceFor(replay: ReplayRecord, event: ReplayTimelineEvent): {
  source: ReplayIntelligenceSource;
  confidence: ReplayIntelligenceConfidence;
  reason: string;
} {
  if (event.actionId === "insight:turn-attributed") {
    return {
      source: "capture-snapshot",
      confidence: "reconstructed",
      reason: "The legacy RiftAtlas action was attributed from an explicit captured player turn."
    };
  }
  if (event.actionId === "insight:raw-authoritative") {
    return {
      source: "game-log",
      confidence: "confirmed",
      reason: "The retained RiftAtlas action log supplied the player and card identity."
    };
  }
  if (event.id.startsWith("inferred-hold:")) {
    return { source: "capture-snapshot", confidence: "inferred", reason: "Derived from a score change between captured states." };
  }
  if (replay.platform === "sim" && replay.structuredEvents?.length) {
    return { source: "game-data", confidence: "confirmed", reason: "Reported directly by the simulator event stream." };
  }
  if (replay.platform === "atlas") {
    return replay.structuredEvents?.length || event.id.includes(":row:")
      ? { source: "game-log", confidence: "confirmed", reason: "Reported by the RiftAtlas game log." }
      : { source: "capture-snapshot", confidence: "reconstructed", reason: "Reconstructed from captured RiftAtlas snapshots." };
  }
  if (replay.platform === "tcga") {
    return {
      source: "state-diff",
      confidence: "reconstructed",
      reason: CARD_EVENT_TYPES.has(event.type)
        ? "Reconstructed by comparing consecutive visible TCGA states."
        : "Reconstructed from visible TCGA game state."
    };
  }
  return { source: "capture-snapshot", confidence: "reconstructed", reason: "Reconstructed from captured game snapshots." };
}

export function replayEventVideoTimeMs(replay: ReplayRecord, event: Pick<ReplayTimelineEvent, "capturedAt">): number | undefined {
  if (!replay.video) return undefined;
  const eventAt = Date.parse(event.capturedAt);
  const startedAt = Date.parse(replay.video.startedAt || replay.capturedAt);
  if (!Number.isFinite(eventAt) || !Number.isFinite(startedAt)) return undefined;
  return Math.min(Math.max(0, eventAt - startedAt), Math.max(0, replay.video.durationMs || eventAt - startedAt));
}

function buildStats(events: ReplayIntelligenceEvent[], model: AtlasReplayViewModel): ReplayIntelligenceSummary["stats"] {
  const gameNumbers = new Set(events.map((event) => event.gameNumber ?? 1));
  const reconstructedTurns = model.turns.filter((turn) => !/setup/i.test(turn.label)).length;
  const explicitTurnStarts = events.filter((event) => event.type === "turn-start").length;
  return {
    games: Math.max(1, gameNumbers.size),
    turns: Math.max(reconstructedTurns, explicitTurnStarts),
    cardActions: events.filter(isCardEvent).length,
    draws: events.filter((event) => event.type === "draw").length,
    plays: events.filter((event) => event.type === "play").length,
    moves: events.filter((event) => event.type === "move").length,
    scoringEvents: events.filter((event) => event.type === "score" || event.type === "scoreboard").length,
    combats: events.filter((event) => event.type === "combat").length,
    battlefieldChanges: events.filter((event) => event.type === "battlefield").length,
    mulligans: events.filter((event) => event.type === "mulligan" || /mulligan/i.test(event.text)).length
  };
}

function buildCoverage(
  events: ReplayIntelligenceEvent[],
  replay: ReplayRecord
): ReplayIntelligenceSummary["coverage"] {
  const count = (confidence: ReplayIntelligenceConfidence) => events.filter((event) => event.confidence === confidence).length;
  const confirmed = count("confirmed");
  const reconstructed = count("reconstructed");
  const inferred = count("inferred");
  const manual = count("manual");
  const evidenceWeight = confirmed + manual + reconstructed * 0.65 + inferred * 0.3;
  const ratio = events.length ? evidenceWeight / events.length : 0;
  const grade = events.length >= 12 && ratio >= 0.8 ? "high" : events.length >= 5 && ratio >= 0.5 ? "medium" : "limited";
  return {
    grade,
    totalEvents: events.length,
    confirmed,
    reconstructed,
    inferred,
    manual,
    cardEvents: events.filter(isCardEvent).length,
    scoreEvents: events.filter((event) => event.type === "score" || event.type === "scoreboard").length,
    turnEvents: events.filter((event) => event.type === "turn-start" || event.type === "turn-end").length,
    hasVideo: Boolean(replay.video)
  };
}

function buildCardJourneys(events: ReplayIntelligenceEvent[]): ReplayIntelligenceCardJourney[] {
  const groups = new Map<string, ReplayIntelligenceEvent[]>();
  for (const event of events) {
    if (!event.cardName && !event.cardId) continue;
    const identity = normalizeCard(event.cardId || event.cardName);
    if (!identity) continue;
    const key = `${event.gameNumber ?? 1}|${event.side}|${identity}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    const sorted = [...group].sort((left, right) => eventTime(left) - eventTime(right));
    const outcomes = new Set<string>();
    let enteredHandAt: number | undefined;
    let knownHandTimeMs = 0;
    for (const event of sorted) {
      const from = normalizeZone(event.fromZone);
      const to = normalizeZone(event.toZone || event.destination);
      if (event.type === "draw" || to === "hand") {
        outcomes.add("drawn");
        enteredHandAt ??= eventTime(event);
      }
      if (event.type === "play") outcomes.add("played");
      if (to.includes("recycle") || /recycl/i.test(event.text)) outcomes.add("recycled");
      if (to.includes("discard") || to.includes("trash") || /discard|trash/i.test(event.text)) outcomes.add("discarded");
      if (event.type === "move") outcomes.add("moved");
      if (enteredHandAt != null && (from === "hand" || event.type === "play" || to.includes("recycle") || to.includes("discard") || to.includes("trash"))) {
        knownHandTimeMs += Math.max(0, eventTime(event) - enteredHandAt);
        enteredHandAt = undefined;
      }
    }
    const first = sorted[0];
    const last = sorted.at(-1) ?? first;
    return {
      id,
      gameNumber: first.gameNumber ?? 1,
      side: first.side,
      cardName: sorted.find((event) => event.cardName)?.cardName || first.cardId || "Known card",
      cardId: sorted.find((event) => event.cardId)?.cardId,
      firstSeenAt: first.capturedAt,
      lastSeenAt: last.capturedAt,
      firstVideoTimeMs: first.videoTimeMs,
      knownHandTimeMs: knownHandTimeMs || undefined,
      outcomes: [...outcomes],
      confidence: lowestConfidence(sorted.map((event) => event.confidence)),
      events: sorted.map((event) => ({
        eventId: event.id,
        capturedAt: event.capturedAt,
        videoTimeMs: event.videoTimeMs,
        type: event.type,
        fromZone: event.fromZone,
        toZone: event.toZone,
        destination: event.destination,
        confidence: event.confidence
      }))
    } satisfies ReplayIntelligenceCardJourney;
  }).sort((left, right) => Date.parse(left.firstSeenAt) - Date.parse(right.firstSeenAt));
}

function buildMoments(
  events: ReplayIntelligenceEvent[],
  journeys: ReplayIntelligenceCardJourney[]
): ReplayIntelligenceMoment[] {
  const moments: ReplayIntelligenceMoment[] = [];
  const add = (event: ReplayIntelligenceEvent | undefined, moment: Omit<ReplayIntelligenceMoment, "id" | "eventId" | "capturedAt" | "videoTimeMs" | "side" | "confidence">) => {
    moments.push({
      id: `${moment.kind}:${event?.id ?? moments.length}`,
      ...moment,
      eventId: event?.id,
      capturedAt: event?.capturedAt,
      videoTimeMs: event?.videoTimeMs,
      side: event?.side,
      confidence: event?.confidence ?? "inferred"
    });
  };
  const mulligan = events.find((event) => event.type === "mulligan" || /mulligan/i.test(event.text));
  if (mulligan) add(mulligan, { kind: "decision", title: "Opening-hand decision", body: "Review what the hand was trying to do and whether the redraw improved the early curve." });
  for (const event of events.filter((item) => item.type === "score" && (item.pointsScored ?? 0) > 0).slice(0, 4)) {
    add(event, { kind: "swing", title: `${event.side === "me" ? "Your" : event.side === "opponent" ? "Opponent" : "A"} scoring window`, body: `${event.pointsScored ? `${event.pointsScored} point${event.pointsScored === 1 ? "" : "s"} recorded. ` : ""}Review the setup immediately before this score.` });
  }
  for (const event of events.filter((item) => item.type === "combat").slice(0, 3)) {
    add(event, { kind: "decision", title: "Combat decision", body: `Review commitments, alternatives and the resulting battlefield position${event.combat?.winner ? `; the captured winner was ${event.combat.winner}` : ""}.` });
  }
  for (const journey of journeys.filter((item) => (item.knownHandTimeMs ?? 0) >= 45_000).slice(0, 3)) {
    const event = events.find((item) => item.id === journey.events[0]?.eventId);
    add(event, { kind: "pattern", title: `${journey.cardName} stayed in hand`, body: `The card remained in a known hand for about ${shortDuration(journey.knownHandTimeMs ?? 0)}. Review whether that flexibility was valuable or whether an earlier use existed.` });
  }
  const battlefield = events.find((event) => event.type === "battlefield");
  if (battlefield) add(battlefield, { kind: "decision", title: "Battlefield state changed", body: "Review how the new battlefield layout changed scoring priorities and movement options." });
  return moments.slice(0, 12);
}

function buildStory(
  replay: ReplayRecord,
  model: AtlasReplayViewModel,
  events: ReplayIntelligenceEvent[],
  journeys: ReplayIntelligenceCardJourney[],
  stats: ReplayIntelligenceSummary["stats"]
): string[] {
  if (!events.length) return ["No structured timeline could be reconstructed from this replay yet."];
  const story = [`${model.platformLabel} supplied ${events.length} usable timeline event${events.length === 1 ? "" : "s"} across ${stats.games} game${stats.games === 1 ? "" : "s"}.`];
  if (stats.mulligans) story.push(`${stats.mulligans} mulligan-related event${stats.mulligans === 1 ? " was" : "s were"} captured before play.`);
  if (stats.plays || stats.moves || stats.draws) story.push(`${stats.draws} draw${stats.draws === 1 ? "" : "s"}, ${stats.plays} play${stats.plays === 1 ? "" : "s"} and ${stats.moves} move${stats.moves === 1 ? "" : "s"} form the visible card-action story.`);
  if (stats.scoringEvents) story.push(`${stats.scoringEvents} scoring update${stats.scoringEvents === 1 ? "" : "s"} were detected; the replay finished at ${model.scoreLabel}.`);
  const busiest = [...journeys].sort((left, right) => right.events.length - left.events.length)[0];
  if (busiest && busiest.events.length > 1) story.push(`${busiest.cardName} had the longest visible journey with ${busiest.events.length} tracked action${busiest.events.length === 1 ? "" : "s"}.`);
  if (replay.intelligence?.corrections.length) story.push(`${replay.intelligence.corrections.length} event correction${replay.intelligence.corrections.length === 1 ? " has" : "s have"} been reviewed manually.`);
  return story;
}

function buildLimitations(replay: ReplayRecord, events: ReplayIntelligenceEvent[], grade: ReplayIntelligenceSummary["coverage"]["grade"]): string[] {
  const limitations: string[] = [];
  if (replay.platform === "atlas") limitations.push("RiftAtlas does not expose every hidden draw identity, rune choice or private hand transition in its visible log.");
  if (replay.platform === "tcga") limitations.push("TCGA card actions are reconstructed from visible state changes; brief or hidden transitions may be missing or combined.");
  if (!replay.structuredEvents?.length) limitations.push("This replay predates the structured event stream, so its timeline relies on retained capture snapshots.");
  if (!replay.video) limitations.push("No local video is attached, so event rows cannot jump to footage.");
  if (!events.some((event) => event.cardName || event.cardId)) limitations.push("No named card actions were available for card-journey analysis.");
  if (grade === "limited") limitations.push("Evidence coverage is limited; use the timeline as a review aid rather than a complete game record.");
  return limitations;
}

function isCardEvent(event: ReplayIntelligenceEvent): boolean {
  return Boolean(event.cardName || event.cardId || event.cardCount) && CARD_EVENT_TYPES.has(event.type);
}

function lowestConfidence(values: ReplayIntelligenceConfidence[]): ReplayIntelligenceConfidence {
  if (values.includes("inferred")) return "inferred";
  if (values.includes("reconstructed")) return "reconstructed";
  if (values.includes("manual")) return "manual";
  return "confirmed";
}

function normalizeCard(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeZone(value = ""): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function eventTime(event: Pick<ReplayTimelineEvent, "capturedAt">): number {
  const time = Date.parse(event.capturedAt);
  return Number.isFinite(time) ? time : 0;
}

function shortDuration(valueMs: number): string {
  const seconds = Math.max(1, Math.round(valueMs / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
