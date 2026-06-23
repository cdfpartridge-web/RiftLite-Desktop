import {
  deckTrackerCardKey,
  deckTrackerCodeFromImage,
  normalizeDeckTrackerKey,
  visionDeckTrackerCards,
  type DeckTrackerLibraryCard
} from "./deckTracker.js";
import type {
  DeckTrackerObservation,
  DeckTrackerZone,
  GamePlatform,
  SavedDeck,
  VisionDeckTrackerStatus,
  VisionDeckTrackerSuggestion,
  VisionRenderedCardObservation
} from "./types.js";

const HIGH_CONFIDENCE = 0.86;
const MEDIUM_CONFIDENCE = 0.68;

export interface VisionDeckTrackerMatchResult {
  observations: DeckTrackerObservation[];
  suggestions: VisionDeckTrackerSuggestion[];
  confidenceScore: number;
  message: string;
  ignoredMatches?: Array<{ name: string; role: DeckTrackerLibraryCard["role"]; confidenceScore: number }>;
  frameDiagnostics?: Record<string, unknown>;
}

export function emptyVisionDeckTrackerStatus(
  enabled: boolean,
  platform: GamePlatform | "none",
  message = enabled ? "Vision tracker is waiting for an active deck." : "Vision deck tracker is off."
): VisionDeckTrackerStatus {
  return {
    state: enabled ? "waiting-for-deck" : "disabled",
    enabled,
    active: false,
    platform,
    message,
    updatedAt: new Date().toISOString(),
    frameId: "",
    confidenceScore: 0,
    processedFrames: 0,
    skippedFrames: 0,
    suggestions: []
  };
}

export function buildVisionDeckTrackerObservations(
  deck: SavedDeck | null,
  platform: GamePlatform,
  renderedCards: VisionRenderedCardObservation[],
  capturedAt: string,
  frameId: string
): VisionDeckTrackerMatchResult {
  const deckCards = visionDeckTrackerCards(deck);
  if (!deck || !deckCards.length) {
    return {
      observations: [],
      suggestions: [],
      confidenceScore: 0,
      message: deck ? "Active deck has no main deck cards to match." : "Set an active deck to use Vision Deck Tracker."
    };
  }

  const observations: DeckTrackerObservation[] = [];
  const suggestionsByKey = new Map<string, VisionDeckTrackerSuggestion>();
  const seenObservationSignatures = new Set<string>();
  const ignoredMatchesByKey = new Map<string, { name: string; role: DeckTrackerLibraryCard["role"]; confidenceScore: number }>();
  let confidenceTotal = 0;
  let matched = 0;

  for (const card of renderedCards) {
    const match = bestDeckCardMatch(card, deckCards);
    if (!match || match.score < MEDIUM_CONFIDENCE) {
      continue;
    }
    matched += 1;
    confidenceTotal += match.score;
    if (match.card.role === "legend") {
      ignoredMatchesByKey.set(match.card.cardKey, {
        name: match.card.name,
        role: match.card.role,
        confidenceScore: roundConfidence(match.score)
      });
      continue;
    }
    const zone = sanitizeZone(card.zone);
    const signature = `${match.card.cardKey}:${zone}:${Math.round(card.zoneRect?.x ?? 0)}:${Math.round(card.zoneRect?.y ?? 0)}`;
    if (match.score >= HIGH_CONFIDENCE) {
      if (seenObservationSignatures.has(signature)) {
        continue;
      }
      seenObservationSignatures.add(signature);
      observations.push({
        cardKey: match.card.cardKey,
        name: match.card.name,
        code: match.card.code,
        cardId: match.card.cardId,
        imageUrl: match.card.imageUrl,
        zone,
        count: 1,
        platform,
        confidence: match.score >= 0.92 ? "tracked" : "estimated",
        capturedAt,
        source: "vision",
        confidenceScore: roundConfidence(match.score),
        frameId,
        zoneRect: card.zoneRect
      });
      continue;
    }
    const existing = suggestionsByKey.get(match.card.cardKey);
    if (existing && existing.confidenceScore >= match.score) {
      continue;
    }
    suggestionsByKey.set(match.card.cardKey, {
      cardKey: match.card.cardKey,
      name: match.card.name,
      code: match.card.code,
      cardId: match.card.cardId,
      imageUrl: match.card.imageUrl,
      zone,
      platform,
      confidenceScore: roundConfidence(match.score),
      capturedAt,
      frameId,
      zoneRect: card.zoneRect
    });
  }

  const suggestions = [...suggestionsByKey.values()]
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, 6);
  const ignoredMatches = [...ignoredMatchesByKey.values()];
  const confidenceScore = matched ? roundConfidence(confidenceTotal / matched) : 0;
  const message = observations.length
    ? `Vision matched ${observations.length} visible card${observations.length === 1 ? "" : "s"}.`
    : suggestions.length
      ? "Vision found likely cards. Confirm suggestions before they affect odds."
      : ignoredMatches.length
        ? `Vision recognised your ${ignoredMatches[0]?.role === "legend" ? "legend" : "card"} and is waiting for deck cards.`
      : renderedCards.length
        ? "Vision saw card-like elements but could not confidently match your active deck."
        : "Vision is waiting for visible local cards.";

  return { observations, suggestions, confidenceScore, message, ignoredMatches };
}

function bestDeckCardMatch(
  renderedCard: VisionRenderedCardObservation,
  deckCards: DeckTrackerLibraryCard[]
): { card: DeckTrackerLibraryCard; score: number } | null {
  const renderedAliases = renderedCardAliases(renderedCard);
  if (!renderedAliases.length) {
    return null;
  }
  let best: { card: DeckTrackerLibraryCard; score: number } | null = null;
  for (const card of deckCards) {
    const score = cardMatchScore(card, renderedAliases, renderedCard);
    if (!best || score > best.score) {
      best = { card, score };
    }
  }
  return best && best.score > 0 ? best : null;
}

function renderedCardAliases(card: VisionRenderedCardObservation): string[] {
  const code = card.code || deckTrackerCodeFromImage(card.imageUrl || "");
  const aliases = [
    card.cardId,
    code,
    card.name,
    deckTrackerCardKey({ cardId: card.cardId, imageUrl: card.imageUrl, name: card.name, code })
  ]
    .map((value) => normalizeDeckTrackerKey(value || ""))
    .filter(Boolean);
  return [...new Set(aliases)];
}

function cardMatchScore(
  deckCard: DeckTrackerLibraryCard,
  renderedAliases: string[],
  renderedCard: VisionRenderedCardObservation
): number {
  const deckAliases = new Set(deckCard.aliases);
  for (const alias of renderedAliases) {
    if (alias && deckAliases.has(alias)) {
      const raw = [renderedCard.cardId, renderedCard.code, deckTrackerCodeFromImage(renderedCard.imageUrl || "")]
        .map((value) => normalizeDeckTrackerKey(value || ""));
      return raw.includes(alias) ? Math.max(0.94, renderedCard.confidenceScore || 0.94) : Math.max(0.9, renderedCard.confidenceScore || 0.9);
    }
  }

  const renderedName = normalizeDeckTrackerKey(renderedCard.name || "");
  const deckName = normalizeDeckTrackerKey(deckCard.name || "");
  if (renderedName && deckName) {
    if (renderedName === deckName) {
      return Math.max(0.9, renderedCard.confidenceScore || 0.9);
    }
    if (renderedName.length >= 8 && (deckName.includes(renderedName) || renderedName.includes(deckName))) {
      return Math.max(0.72, Math.min(0.84, renderedCard.confidenceScore || 0.76));
    }
  }
  return 0;
}

function sanitizeZone(zone: DeckTrackerZone): DeckTrackerZone {
  return zone || "unknown";
}

function roundConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
