import type { CaptureEvent, GamePlatform } from "./types.js";

export interface EnhancedInsightLiveSession {
  platform: GamePlatform;
  sessionStartedAt: string;
  startEvent: CaptureEvent;
  enabledAtStart: boolean;
  gameNumber: number;
  awaitingNextGame: boolean;
}

/**
 * Atlas reports each game result as a match-end while the main capture service
 * waits to see whether the series continues. Keep the Enhanced Insights clock
 * open across that boundary; the final draft is the authoritative series end.
 */
export function isAtlasIntermediateGameEnd(event: CaptureEvent): boolean {
  if (event.platform !== "atlas" || event.kind !== "match-end") {
    return false;
  }
  const reason = text(event.payload.reason);
  const resultKind = text(event.payload.atlasResultKind);
  if (reason !== "result-text-detected" || resultKind === "match-terminal") {
    return false;
  }
  const endText = text(event.payload.endText);
  return resultKind === "game-result"
    || /(?:confirm|choose|select|report)\s+game\s+\d+\s+winner|(?:confirm|choose|select|report)\s+(?:the\s+)?winner\s+(?:for|of)\s+game\s+\d+|game\s+\d+.{0,48}(?:winner|choose|select|confirm|report)|you win|you lose|you won|you lost|victory|defeat|wins!|winner/i.test(endText);
}

export function advanceEnhancedInsightLiveSession(
  current: EnhancedInsightLiveSession | null,
  event: CaptureEvent,
  enabledNow: boolean
): EnhancedInsightLiveSession | null {
  if (event.kind === "match-start") {
    const explicitGameNumber = captureGameNumber(event);
    const incomingSessionStartedAt = captureSessionStartedAt(event);
    const continuing = Boolean(
      current
      && current.platform === event.platform
      && (!incomingSessionStartedAt || incomingSessionStartedAt === current.sessionStartedAt)
    );
    if (!current || !continuing) {
      const sessionStartedAt = incomingSessionStartedAt || event.capturedAt;
      return {
        platform: event.platform,
        sessionStartedAt,
        startEvent: sessionStartedAt === event.capturedAt ? event : { ...event, capturedAt: sessionStartedAt },
        enabledAtStart: enabledNow,
        gameNumber: explicitGameNumber || 1,
        awaitingNextGame: false
      };
    }
    return {
      ...current,
      gameNumber: explicitGameNumber
        || (current.awaitingNextGame ? Math.min(3, current.gameNumber + 1) : current.gameNumber),
      awaitingNextGame: false
    };
  }
  if (event.kind !== "match-end" || !current || current.platform !== event.platform) {
    return current;
  }
  if (isAtlasIntermediateGameEnd(event)) {
    return { ...current, awaitingNextGame: true };
  }
  return null;
}

function captureGameNumber(event: CaptureEvent): number {
  const value = Number(event.payload.atlasBo3GameNumber ?? event.payload.gameNumber);
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 0;
}

function captureSessionStartedAt(event: CaptureEvent): string {
  const value = event.payload.enhancedInsightsSessionStartedAt;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
