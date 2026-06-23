import {
  buildVisionDeckTrackerObservations,
  type VisionDeckTrackerMatchResult
} from "../shared/visionDeckTracker";
import {
  normalizeDeckTrackerKey,
  visionDeckTrackerCards,
  type DeckTrackerLibraryCard
} from "../shared/deckTracker";
import type {
  DeckTrackerObservation,
  DeckTrackerZone,
  GamePlatform,
  SavedDeck,
  VisionFrameCandidate,
  VisionFrameSample,
  VisionRenderedCardObservation
} from "../shared/types";

type VisionWorkerRequest = {
  id: string;
  deck: SavedDeck | null;
  platform: GamePlatform;
  renderedCards: VisionRenderedCardObservation[];
  frameCandidates?: VisionFrameCandidate[];
  frameSample?: VisionFrameSample | null;
  capturedAt: string;
  frameId: string;
};

type VisionWorkerResponse = {
  id: string;
  result?: VisionDeckTrackerMatchResult;
  error?: string;
};

type PixelSignature = {
  pixels: Uint8ClampedArray;
  luminanceHash: Uint8Array;
  variance: number;
};

type FrameCandidateRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  zone: DeckTrackerZone;
  source: string;
};

type FrameMatch = {
  card: DeckTrackerLibraryCard;
  score: number;
  rect: FrameCandidateRect;
};

const SIGNATURE_WIDTH = 18;
const SIGNATURE_HEIGHT = 25;
const CARD_ASPECT = 0.715;
const FRAME_HIGH_CONFIDENCE = 0.82;
const FRAME_MEDIUM_CONFIDENCE = 0.74;
const FALLBACK_HIGH_CONFIDENCE = 0.87;
const cardSignatureCache = new Map<string, Promise<PixelSignature | null>>();

self.onmessage = (event: MessageEvent<VisionWorkerRequest>) => {
  void handleVisionRequest(event.data);
};

async function handleVisionRequest(payload: VisionWorkerRequest): Promise<void> {
  try {
    const domResult = buildVisionDeckTrackerObservations(
      payload.deck,
      payload.platform,
      payload.renderedCards,
      payload.capturedAt,
      payload.frameId
    );
    const frameResult = await buildFrameVisionResult(payload);
    const result = mergeVisionResults(domResult, frameResult, payload);
    self.postMessage({ id: payload.id, result } satisfies VisionWorkerResponse);
  } catch (error) {
    self.postMessage({
      id: payload.id,
      error: error instanceof Error ? error.message : "Vision tracker worker failed."
    } satisfies VisionWorkerResponse);
  }
}

async function buildFrameVisionResult(payload: VisionWorkerRequest): Promise<VisionDeckTrackerMatchResult> {
  const deckCards = visionDeckTrackerCards(payload.deck);
  const imageCards = deckCards.filter((card) => card.imageUrl);
  if (!payload.frameSample || !imageCards.length) {
    return {
      observations: [],
      suggestions: [],
      confidenceScore: 0,
      message: "",
      frameDiagnostics: {
        frameCaptured: Boolean(payload.frameSample),
        deckImageCount: imageCards.length,
        candidateCount: payload.frameCandidates?.length ?? 0
      }
    };
  }

  const frameBitmap = await bitmapFromDataUrl(payload.frameSample.dataUrl);
  const library = await Promise.all(imageCards.map(async (card) => ({
    card,
    signature: await signatureForCard(card)
  })));
  const usableLibrary = library.filter((item): item is { card: DeckTrackerLibraryCard; signature: PixelSignature } => Boolean(item.signature));
  const frameCandidates = frameCandidateRects(payload.frameSample, payload.frameCandidates ?? []);
  const observations: DeckTrackerObservation[] = [];
  const suggestions = new Map<string, NonNullable<VisionDeckTrackerMatchResult["suggestions"]>[number]>();
  const ignoredMatches = new Map<string, { name: string; role: DeckTrackerLibraryCard["role"]; confidenceScore: number }>();
  const bestMatches: Array<{ name: string; score: number; zone: DeckTrackerZone; source: string; rect: string }> = [];
  const seenSignatures = new Set<string>();

  for (const rect of frameCandidates) {
    const crop = normalizeCardCrop(rect, payload.frameSample);
    const cropSignature = signatureFromBitmap(frameBitmap, crop);
    if (!cropSignature || cropSignature.variance < 2.5) {
      continue;
    }
    let best: FrameMatch | null = null;
    for (const { card, signature } of usableLibrary) {
      const score = signatureSimilarity(cropSignature, signature);
      if (!best || score > best.score) {
        best = { card, score, rect: crop };
      }
    }
    if (!best || best.score < FRAME_MEDIUM_CONFIDENCE) {
      continue;
    }
    bestMatches.push({
      name: best.card.name,
      score: roundConfidence(best.score),
      zone: best.rect.zone,
      source: best.rect.source,
      rect: `${Math.round(best.rect.x)},${Math.round(best.rect.y)},${Math.round(best.rect.width)},${Math.round(best.rect.height)}`
    });
    const highConfidenceThreshold = best.rect.source.startsWith("fallback") ? FALLBACK_HIGH_CONFIDENCE : FRAME_HIGH_CONFIDENCE;
    if (best.card.role === "legend") {
      ignoredMatches.set(best.card.cardKey, {
        name: best.card.name,
        role: best.card.role,
        confidenceScore: roundConfidence(best.score)
      });
      continue;
    }
    const signature = `${best.card.cardKey}:${best.rect.zone}:${Math.round(best.rect.x / 8)}:${Math.round(best.rect.y / 8)}`;
    if (best.score >= highConfidenceThreshold) {
      if (seenSignatures.has(signature)) {
        continue;
      }
      seenSignatures.add(signature);
      observations.push({
        cardKey: best.card.cardKey,
        name: best.card.name,
        code: best.card.code,
        cardId: best.card.cardId,
        imageUrl: best.card.imageUrl,
        zone: best.rect.zone,
        count: 1,
        platform: payload.platform,
        confidence: best.score >= 0.9 ? "tracked" : "estimated",
        capturedAt: payload.capturedAt,
        source: "vision",
        confidenceScore: roundConfidence(best.score),
        frameId: payload.frameId,
        zoneRect: {
          x: Math.round(best.rect.x),
          y: Math.round(best.rect.y),
          width: Math.round(best.rect.width),
          height: Math.round(best.rect.height)
        }
      });
      continue;
    }
    const existing = suggestions.get(best.card.cardKey);
    if (!existing || existing.confidenceScore < best.score) {
      suggestions.set(best.card.cardKey, {
        cardKey: best.card.cardKey,
        name: best.card.name,
        code: best.card.code,
        cardId: best.card.cardId,
        imageUrl: best.card.imageUrl,
        zone: best.rect.zone,
        platform: payload.platform,
        confidenceScore: roundConfidence(best.score),
        capturedAt: payload.capturedAt,
        frameId: payload.frameId,
        zoneRect: {
          x: Math.round(best.rect.x),
          y: Math.round(best.rect.y),
          width: Math.round(best.rect.width),
          height: Math.round(best.rect.height)
        }
      });
    }
  }

  const suggestionList = [...suggestions.values()].sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 6);
  const confidenceScore = observations.length
    ? roundConfidence(observations.reduce((total, item) => total + (item.confidenceScore ?? 0), 0) / observations.length)
    : suggestionList.length
      ? roundConfidence(suggestionList.reduce((total, item) => total + item.confidenceScore, 0) / suggestionList.length)
      : 0;
  return {
    observations,
    suggestions: suggestionList,
    confidenceScore,
    message: observations.length
      ? `Vision matched ${observations.length} card${observations.length === 1 ? "" : "s"} from the game frame.`
      : suggestionList.length
        ? "Vision found likely frame matches. Confirm suggestions before they affect odds."
        : ignoredMatches.size
          ? "Vision recognised your legend and is waiting for deck cards."
        : "Vision frame sampled but no active-deck cards were confident enough.",
    ignoredMatches: [...ignoredMatches.values()],
    frameDiagnostics: {
      frameCaptured: true,
      frameSize: `${payload.frameSample.width}x${payload.frameSample.height}`,
      viewport: `${payload.frameSample.viewportWidth}x${payload.frameSample.viewportHeight}`,
      deckImageCount: usableLibrary.length,
      deckImageErrors: imageCards.length - usableLibrary.length,
      candidateCount: frameCandidates.length,
      bestMatches: bestMatches.sort((a, b) => b.score - a.score).slice(0, 10)
    }
  };
}

function mergeVisionResults(
  domResult: VisionDeckTrackerMatchResult,
  frameResult: VisionDeckTrackerMatchResult,
  payload: VisionWorkerRequest
): VisionDeckTrackerMatchResult {
  const domCardZones = new Set(domResult.observations.map((item) => `${item.cardKey}:${item.zone}`));
  const observationSignatures = new Set(domResult.observations.map((item) => (
    `${item.cardKey}:${item.zone}:${Math.round(item.zoneRect?.x ?? 0)}:${Math.round(item.zoneRect?.y ?? 0)}`
  )));
  const frameObservations = frameResult.observations.filter((item) => {
    if (domCardZones.has(`${item.cardKey}:${item.zone}`)) {
      return false;
    }
    const signature = `${item.cardKey}:${item.zone}:${Math.round(item.zoneRect?.x ?? 0)}:${Math.round(item.zoneRect?.y ?? 0)}`;
    if (observationSignatures.has(signature)) {
      return false;
    }
    observationSignatures.add(signature);
    return true;
  });
  const suggestionMap = new Map(domResult.suggestions.map((item) => [item.cardKey, item]));
  for (const suggestion of frameResult.suggestions) {
    const existing = suggestionMap.get(suggestion.cardKey);
    if (!existing || existing.confidenceScore < suggestion.confidenceScore) {
      suggestionMap.set(suggestion.cardKey, suggestion);
    }
  }
  const observations = [...domResult.observations, ...frameObservations];
  const suggestions = [...suggestionMap.values()].sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 6);
  const confidenceValues = [
    ...observations.map((item) => item.confidenceScore ?? 0),
    ...suggestions.map((item) => item.confidenceScore)
  ].filter((value) => value > 0);
  const confidenceScore = confidenceValues.length
    ? roundConfidence(confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length)
    : Math.max(domResult.confidenceScore, frameResult.confidenceScore);
  const ignoredMatches = [
    ...(domResult.ignoredMatches ?? []),
    ...(frameResult.ignoredMatches ?? [])
  ];
  const message = frameObservations.length || frameResult.suggestions.length || (!domResult.observations.length && !domResult.suggestions.length && Boolean(frameResult.ignoredMatches?.length))
    ? frameResult.message
    : domResult.message;
  return {
    observations,
    suggestions,
    confidenceScore,
    message,
    ignoredMatches,
    frameDiagnostics: {
      ...frameResult.frameDiagnostics,
      domRenderedCount: payload.renderedCards.length,
      frameCandidateCount: payload.frameCandidates?.length ?? 0
    }
  };
}

function frameCandidateRects(sample: VisionFrameSample, candidates: VisionFrameCandidate[]): FrameCandidateRect[] {
  const rects: FrameCandidateRect[] = [];
  const seen = new Set<string>();
  const scaleX = sample.width / Math.max(1, sample.viewportWidth);
  const scaleY = sample.height / Math.max(1, sample.viewportHeight);
  const push = (rect: FrameCandidateRect) => {
    const bounded = clampRect(rect, sample.width, sample.height);
    if (!bounded || bounded.width < 16 || bounded.height < 22) {
      return;
    }
    const key = `${Math.round(bounded.x / 6)}:${Math.round(bounded.y / 6)}:${Math.round(bounded.width / 6)}:${Math.round(bounded.height / 6)}:${bounded.zone}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    rects.push(bounded);
  };

  for (const candidate of candidates) {
    push({
      x: candidate.zoneRect.x * scaleX,
      y: candidate.zoneRect.y * scaleY,
      width: candidate.zoneRect.width * scaleX,
      height: candidate.zoneRect.height * scaleY,
      zone: candidate.zone,
      source: candidate.reason || "dom-candidate"
    });
  }

  const boardHeights = [sample.height * 0.15, sample.height * 0.125];
  const boardRows = [sample.height * 0.45, sample.height * 0.54, sample.height * 0.62];
  for (const cardHeight of boardHeights) {
    const cardWidth = cardHeight * CARD_ASPECT;
    const step = Math.max(18, cardWidth * 0.58);
    for (const y of boardRows) {
      for (let x = sample.width * 0.08; x < sample.width * 0.84 - cardWidth; x += step) {
        push({ x, y, width: cardWidth, height: cardHeight, zone: "board", source: "fallback-board" });
        if (rects.length > 96) {
          return rects.slice(0, 104);
        }
      }
    }
  }

  const handHeights = [sample.height * 0.16, sample.height * 0.135, sample.height * 0.11];
  for (const cardHeight of handHeights) {
    const cardWidth = cardHeight * CARD_ASPECT;
    const y = sample.height - cardHeight - sample.height * 0.025;
    const step = Math.max(18, cardWidth * 0.48);
    for (let x = sample.width * 0.06; x < sample.width * 0.94 - cardWidth; x += step) {
      push({ x, y, width: cardWidth, height: cardHeight, zone: "hand", source: "fallback-hand" });
      if (rects.length > 104) {
        return rects.slice(0, 112);
      }
    }
  }

  return rects.slice(0, 112);
}

function normalizeCardCrop(rect: FrameCandidateRect, sample: VisionFrameSample): FrameCandidateRect {
  let { x, y, width, height } = rect;
  const currentAspect = width / Math.max(1, height);
  if (currentAspect > CARD_ASPECT * 1.18) {
    const nextWidth = height * CARD_ASPECT;
    x += (width - nextWidth) / 2;
    width = nextWidth;
  } else if (currentAspect < CARD_ASPECT * 0.82) {
    const nextHeight = width / CARD_ASPECT;
    y += (height - nextHeight) / 2;
    height = nextHeight;
  }
  return clampRect({ ...rect, x, y, width, height }, sample.width, sample.height) ?? rect;
}

function clampRect(rect: FrameCandidateRect, maxWidth: number, maxHeight: number): FrameCandidateRect | null {
  const x = Math.max(0, Math.min(maxWidth - 1, rect.x));
  const y = Math.max(0, Math.min(maxHeight - 1, rect.y));
  const right = Math.max(x + 1, Math.min(maxWidth, rect.x + rect.width));
  const bottom = Math.max(y + 1, Math.min(maxHeight, rect.y + rect.height));
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { ...rect, x, y, width, height };
}

async function signatureForCard(card: DeckTrackerLibraryCard): Promise<PixelSignature | null> {
  const key = card.imageUrl || card.cardId || card.cardKey;
  if (!key) {
    return null;
  }
  let cached = cardSignatureCache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const response = await fetch(card.imageUrl, { cache: "force-cache" });
        if (!response.ok) {
          return null;
        }
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        return signatureFromBitmap(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height, zone: "unknown", source: "deck" });
      } catch {
        return null;
      }
    })();
    cardSignatureCache.set(key, cached);
  }
  return cached;
}

async function bitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

function signatureFromBitmap(bitmap: ImageBitmap, rect: FrameCandidateRect): PixelSignature | null {
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (!width || !height) {
    return null;
  }
  const canvas = new OffscreenCanvas(SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }
  context.drawImage(
    bitmap,
    Math.max(0, Math.round(rect.x)),
    Math.max(0, Math.round(rect.y)),
    width,
    height,
    0,
    0,
    SIGNATURE_WIDTH,
    SIGNATURE_HEIGHT
  );
  const imageData = context.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT).data;
  const pixels = new Uint8ClampedArray(imageData.length);
  pixels.set(imageData);
  const luminance = new Float32Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
  let total = 0;
  for (let i = 0, pixel = 0; i < imageData.length; i += 4, pixel += 1) {
    const value = imageData[i] * 0.299 + imageData[i + 1] * 0.587 + imageData[i + 2] * 0.114;
    luminance[pixel] = value;
    total += value;
  }
  const average = total / luminance.length;
  const hash = new Uint8Array(luminance.length);
  let variance = 0;
  for (let index = 0; index < luminance.length; index += 1) {
    hash[index] = luminance[index] >= average ? 1 : 0;
    const delta = luminance[index] - average;
    variance += delta * delta;
  }
  return { pixels, luminanceHash: hash, variance: Math.sqrt(variance / luminance.length) };
}

function signatureSimilarity(candidate: PixelSignature, card: PixelSignature): number {
  const length = Math.min(candidate.pixels.length, card.pixels.length);
  if (!length) {
    return 0;
  }
  let colorError = 0;
  let colorSamples = 0;
  for (let index = 0; index < length; index += 4) {
    const dr = candidate.pixels[index] - card.pixels[index];
    const dg = candidate.pixels[index + 1] - card.pixels[index + 1];
    const db = candidate.pixels[index + 2] - card.pixels[index + 2];
    colorError += dr * dr + dg * dg + db * db;
    colorSamples += 3;
  }
  const colorScore = 1 - Math.min(1, Math.sqrt(colorError / Math.max(1, colorSamples)) / 255);
  let hashDiff = 0;
  const hashLength = Math.min(candidate.luminanceHash.length, card.luminanceHash.length);
  for (let index = 0; index < hashLength; index += 1) {
    if (candidate.luminanceHash[index] !== card.luminanceHash[index]) {
      hashDiff += 1;
    }
  }
  const hashScore = 1 - (hashDiff / Math.max(1, hashLength));
  return roundConfidence(colorScore * 0.74 + hashScore * 0.26);
}

function roundConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
