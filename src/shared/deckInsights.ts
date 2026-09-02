import { riftboundBasePrintCode, riftboundCardCodeAliases } from "./cardIdentity.js";
import { parseCommunityDeckSnapshot } from "./communityDecks.js";
import { buildDeckPerformance, type DeckPerformanceStats, type DeckRecordStats } from "./deckPerformance.js";
import { MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON, type MulliganLabRegistryCard } from "./mulliganLab.js";
import type { ReplayInsightCardReport, ReplayInsightGameStage } from "./replayInsights.js";
import type { DeckEntry, MatchDraft, SavedDeck } from "./types.js";

export interface DeckInsightCard {
  key: string;
  name: string;
  cardId: string;
  imageUrl: string;
  qty: number;
  section: "champion" | "main" | "sideboard" | "battlefield" | "rune";
  type: string;
  supertype: string;
  costEnergy: number | null;
  costPower: number | null;
}

export interface DeckInsightCurveBucket {
  key: string;
  label: string;
  copies: number;
  cards: number;
  percentage: number;
}

export interface DeckInsightTypeSlice {
  type: string;
  copies: number;
  cards: number;
  percentage: number;
}

export interface DeckInsightCopyProfile {
  copies: number;
  cards: number;
  label: string;
}

export interface DeckInsightComposition {
  title: string;
  legend: string;
  legendCard: DeckInsightCard | null;
  champions: DeckInsightCard[];
  mainDeck: DeckInsightCard[];
  sideboard: DeckInsightCard[];
  battlefields: DeckInsightCard[];
  runes: DeckInsightCard[];
  mainDeckCopies: number;
  uniqueMainDeckCards: number;
  sideboardCopies: number;
  averageEnergy: number | null;
  knownEnergyCopies: number;
  earlyCurveCopies: number;
  twoCostCopies: number;
  highCostCopies: number;
  curve: DeckInsightCurveBucket[];
  types: DeckInsightTypeSlice[];
  copyProfile: DeckInsightCopyProfile[];
}

export interface DeckInsightRecordSlice extends DeckRecordStats {
  key: string;
  label: string;
}

export interface DeckInsightFormPoint {
  matchId: string;
  capturedAt: string;
  opponentLegend: string;
  result: MatchDraft["result"];
  rollingWinRate: number;
  rollingGames: number;
}

export interface DeckInsightPerformance {
  performance: DeckPerformanceStats;
  formats: DeckInsightRecordSlice[];
  periods: DeckInsightRecordSlice[];
  recentForm: DeckInsightFormPoint[];
  evidenceLabel: "Early" | "Growing" | "Established";
}

export function buildDeckInsightComposition(
  deck: SavedDeck,
  registryCards: Iterable<MulliganLabRegistryCard>
): DeckInsightComposition {
  const registry = buildRegistryLookup(registryCards);
  const snapshot = parseCommunityDeckSnapshot(deck.snapshotJson);
  const extras = parseExtraSnapshotSections(deck.snapshotJson);
  const legend = normalizeCard(snapshot?.legendEntry, "champion", registry)
    ?? normalizeCard(extras.legendEntry, "champion", registry);
  const champions = normalizeSection(extras.champions, "champion", registry);
  const mainDeck = normalizeSection(snapshot?.mainDeck ?? [], "main", registry);
  const sideboard = normalizeSection(snapshot?.sideboard ?? [], "sideboard", registry);
  const battlefields = normalizeSection(snapshot?.battlefields ?? [], "battlefield", registry);
  const runes = normalizeSection(snapshot?.runes ?? [], "rune", registry);
  const mainDeckCopies = sumCopies(mainDeck);
  const knownCostCards = mainDeck.filter((card) => card.costEnergy !== null);
  const knownEnergyCopies = sumCopies(knownCostCards);
  const energyTotal = knownCostCards.reduce((sum, card) => sum + (card.costEnergy ?? 0) * card.qty, 0);

  return {
    title: snapshot?.title || deck.title,
    legend: snapshot?.legend || deck.legend,
    legendCard: legend,
    champions,
    mainDeck,
    sideboard,
    battlefields,
    runes,
    mainDeckCopies,
    uniqueMainDeckCards: mainDeck.length,
    sideboardCopies: sumCopies(sideboard),
    averageEnergy: knownEnergyCopies ? roundOne(energyTotal / knownEnergyCopies) : null,
    knownEnergyCopies,
    earlyCurveCopies: sumCopies(mainDeck.filter((card) => card.costEnergy !== null && card.costEnergy <= 2)),
    twoCostCopies: sumCopies(mainDeck.filter((card) => card.costEnergy === 2)),
    highCostCopies: sumCopies(mainDeck.filter((card) => card.costEnergy !== null && card.costEnergy >= 5)),
    curve: buildCurve(mainDeck, mainDeckCopies),
    types: buildTypes(mainDeck, mainDeckCopies),
    copyProfile: buildCopyProfile(mainDeck)
  };
}

export function buildDeckInsightPerformance(deck: SavedDeck, matches: MatchDraft[]): DeckInsightPerformance {
  const performance = buildDeckPerformance(deck, matches);
  const completed = performance.completedMatches;
  const currentSeasonStart = Date.parse(`${MULLIGAN_LAB_CURRENT_SEASON_STARTED_ON}T00:00:00.000Z`);
  const preseason = completed.filter((match) => safeTime(match.capturedAt) < currentSeasonStart);
  const currentSeason = completed.filter((match) => safeTime(match.capturedAt) >= currentSeasonStart);

  return {
    performance,
    formats: [
      recordSlice("bo1", "Best of 1", completed.filter((match) => match.format === "Bo1")),
      recordSlice("bo3", "Best of 3", completed.filter((match) => match.format === "Bo3"))
    ].filter((slice) => slice.total > 0),
    periods: [
      recordSlice("current-season", "Current season", currentSeason),
      recordSlice("preseason", "Pre-season", preseason)
    ].filter((slice) => slice.total > 0),
    recentForm: buildRecentForm(completed),
    evidenceLabel: completed.length >= 20 ? "Established" : completed.length >= 8 ? "Growing" : "Early"
  };
}

export function deckInsightCardIdentityKeys(card: Pick<DeckInsightCard, "cardId" | "name">): string[] {
  const keys = new Set<string>();
  const baseCode = riftboundBasePrintCode(card.cardId);
  for (const value of [card.cardId, baseCode, card.name]) {
    const key = normalized(value);
    if (key) keys.add(key);
  }
  return [...keys];
}

export interface DeckInsightCardEligibility {
  /** Snapshot-confirmed Game 1 mainboard opportunities only. */
  eligibleCompletedGames: number;
  /** Starting-list context only; it does not prove post-board inclusion. */
  postboardListOpportunityGames: number;
  unknownSnapshotGames: number;
  unresolvedMatches: number;
  basis: "confirmed-g1-mainboard" | "postboard-list-only";
}

export type DeckInsightSampleTier = "counts-only" | "early" | "developing" | "stable";

export interface DeckInsightCardReviewSignal {
  status: "needs-review" | "no-repeat-signal" | "counts-only";
  label: string;
  reason: string;
  score: number;
  opportunities: number;
  sampleTier: DeckInsightSampleTier;
}

export function deckInsightCardEligibility(
  card: DeckInsightCard,
  matches: MatchDraft[],
  gameStage: ReplayInsightGameStage = "all"
): DeckInsightCardEligibility {
  let eligibleCompletedGames = 0;
  let postboardListOpportunityGames = 0;
  let unknownSnapshotGames = 0;
  let unresolvedMatches = 0;
  const cardKeys = new Set(deckInsightCardIdentityKeys(card).map(normalized));

  for (const match of matches) {
    const completed = completedDeckGameNumbers(match);
    if (!completed.length) {
      if (match.status === "saved" && match.result !== "Incomplete") unresolvedMatches += 1;
      continue;
    }
    const scoped = completed.filter((gameNumber) => (
      gameStage === "all" || (gameStage === "preboard" ? gameNumber === 1 : gameNumber > 1)
    ));
    const listRelevantGames = card.section === "sideboard"
      ? scoped.filter((gameNumber) => gameNumber > 1)
      : scoped;
    if (!listRelevantGames.length) continue;
    const snapshot = parseCommunityDeckSnapshot(match.deckSnapshotJson ?? "");
    if (!snapshot) {
      unknownSnapshotGames += listRelevantGames.length;
      continue;
    }
    const entries = card.section === "sideboard" ? snapshot.sideboard : snapshot.mainDeck;
    const listed = entries.some((entry) => deckEntryIdentityKeys(entry).some((key) => cardKeys.has(key)));
    if (!listed) continue;
    if (card.section === "main") eligibleCompletedGames += listRelevantGames.filter((gameNumber) => gameNumber === 1).length;
    postboardListOpportunityGames += listRelevantGames.filter((gameNumber) => gameNumber > 1).length;
  }

  return {
    eligibleCompletedGames,
    postboardListOpportunityGames,
    unknownSnapshotGames,
    unresolvedMatches,
    basis: card.section === "main" ? "confirmed-g1-mainboard" : "postboard-list-only"
  };
}

export function deckInsightSampleTier(opportunities: number): DeckInsightSampleTier {
  if (opportunities >= 30) return "stable";
  if (opportunities >= 10) return "developing";
  if (opportunities >= 5) return "early";
  return "counts-only";
}

export function buildDeckInsightCardReviewSignal(
  report: ReplayInsightCardReport | undefined
): DeckInsightCardReviewSignal {
  const kept = report?.mulligan?.keptGames ?? 0;
  const latePlayed = report?.mulligan?.latePlayedGames ?? 0;
  const offered = report?.mulligan?.offeredGames ?? 0;
  const redrawn = report?.mulligan?.redrawnGames ?? 0;
  const handPlayed = report?.prePlayHand?.laterPlayedGames ?? 0;
  const handNoPlay = report?.prePlayHand?.noCapturedPlayGames ?? 0;
  const resolvedHand = handPlayed + handNoPlay;
  const knownAppearances = report?.prePlayHand?.observedGames ?? 0;
  const recycled = report?.prePlayHand?.recycledOrDiscardedGames ?? 0;
  const opportunities = Math.max(
    offered,
    resolvedHand,
    knownAppearances
  );
  const candidates: Array<{ score: number; label: string; reason: string; opportunities: number }> = [];

  if (kept >= 5 && latePlayed >= 2 && latePlayed / kept >= 0.4) {
    candidates.push({
      score: 400 + Math.round((latePlayed / kept) * 100),
      label: "Keep games with a late name play",
      reason: `${latePlayed} of ${kept} review-grade games with a keep had the first captured play of that card name on turn 4 or later. The played copy may be different.`,
      opportunities: kept
    });
  }
  if (resolvedHand >= 5 && handNoPlay >= 2 && handNoPlay / resolvedHand >= 0.4) {
    candidates.push({
      score: 350 + Math.round((handNoPlay / resolvedHand) * 100),
      label: "Known in hand, no matched play",
      reason: `${handNoPlay} of ${resolvedHand} resolved pre-play hand observations ended without a captured play of that name.`,
      opportunities: resolvedHand
    });
  }
  if (knownAppearances >= 5 && recycled >= 2 && recycled / knownAppearances >= 0.4) {
    candidates.push({
      score: 300 + Math.round((recycled / knownAppearances) * 100),
      label: "Often converted away",
      reason: `${recycled} of ${knownAppearances} review-grade pre-play hand observations included a recycle or discard.`,
      opportunities: knownAppearances
    });
  }
  if (offered >= 5 && redrawn >= 2 && redrawn / offered >= 0.6) {
    candidates.push({
      score: 250 + Math.round((redrawn / offered) * 100),
      label: "Frequently redrawn",
      reason: `${redrawn} of ${offered} captured offer games included a redraw of that card name. Keep and redraw games may overlap when multiple copies were offered.`,
      opportunities: offered
    });
  }

  const strongest = candidates.sort((left, right) => right.score - left.score)[0];
  if (strongest) {
    return {
      status: "needs-review",
      ...strongest,
      sampleTier: deckInsightSampleTier(strongest.opportunities)
    };
  }
  if (opportunities < 5) {
    return {
      status: "counts-only",
      label: "Counts only",
      reason: `Only ${opportunities} relevant opportunit${opportunities === 1 ? "y" : "ies"}; RiftLite will not infer a pattern yet.`,
      score: 0,
      opportunities,
      sampleTier: deckInsightSampleTier(opportunities)
    };
  }
  return {
    status: "no-repeat-signal",
    label: "No repeat signal",
    reason: `No review rule crossed its conservative threshold across ${opportunities} relevant opportunities.`,
    score: 1,
    opportunities,
    sampleTier: deckInsightSampleTier(opportunities)
  };
}

function buildCurve(cards: DeckInsightCard[], totalCopies: number): DeckInsightCurveBucket[] {
  const buckets = Array.from({ length: 8 }, (_, index) => ({
    key: index === 7 ? "7+" : String(index),
    label: index === 7 ? "7+" : String(index),
    copies: 0,
    cards: 0,
    percentage: 0
  }));
  for (const card of cards) {
    if (card.costEnergy === null) continue;
    const index = Math.min(7, Math.max(0, Math.trunc(card.costEnergy)));
    const bucket = buckets[index]!;
    bucket.copies += card.qty;
    bucket.cards += 1;
  }
  for (const bucket of buckets) {
    bucket.percentage = totalCopies ? roundOne((bucket.copies / totalCopies) * 100) : 0;
  }
  return buckets;
}

function buildTypes(cards: DeckInsightCard[], totalCopies: number): DeckInsightTypeSlice[] {
  const grouped = new Map<string, { copies: number; cards: number }>();
  for (const card of cards) {
    const type = card.type || "Unknown";
    const current = grouped.get(type) ?? { copies: 0, cards: 0 };
    current.copies += card.qty;
    current.cards += 1;
    grouped.set(type, current);
  }
  return [...grouped.entries()]
    .map(([type, row]) => ({
      type,
      ...row,
      percentage: totalCopies ? roundOne((row.copies / totalCopies) * 100) : 0
    }))
    .sort((left, right) => right.copies - left.copies || left.type.localeCompare(right.type));
}

function buildCopyProfile(cards: DeckInsightCard[]): DeckInsightCopyProfile[] {
  const grouped = new Map<number, number>();
  for (const card of cards) grouped.set(card.qty, (grouped.get(card.qty) ?? 0) + 1);
  return [...grouped.entries()]
    .map(([copies, count]) => ({
      copies,
      cards: count,
      label: copies === 1 ? "Singletons" : `${copies}-ofs`
    }))
    .sort((left, right) => right.copies - left.copies);
}

function buildRecentForm(matches: MatchDraft[]): DeckInsightFormPoint[] {
  const chronological = [...matches]
    .filter((match) => match.result === "Win" || match.result === "Loss" || match.result === "Draw")
    .sort((left, right) => safeTime(left.capturedAt) - safeTime(right.capturedAt))
    .slice(-20);
  return chronological.map((match, index) => {
    const start = Math.max(0, index - 4);
    const window = chronological.slice(start, index + 1);
    const wins = window.filter((item) => item.result === "Win").length;
    const losses = window.filter((item) => item.result === "Loss").length;
    const decisive = wins + losses;
    return {
      matchId: match.id,
      capturedAt: match.capturedAt,
      opponentLegend: match.opponentChampion,
      result: match.result,
      rollingWinRate: decisive ? Math.round((wins / decisive) * 100) : 0,
      rollingGames: window.length
    };
  });
}

function recordSlice(key: string, label: string, matches: MatchDraft[]): DeckInsightRecordSlice {
  const results = matches.map((match) => match.result).filter((result) => result !== "Incomplete");
  const wins = results.filter((result) => result === "Win").length;
  const losses = results.filter((result) => result === "Loss").length;
  const draws = results.filter((result) => result === "Draw").length;
  const decisive = wins + losses;
  const winRate = decisive ? Math.round((wins / decisive) * 100) : 0;
  return {
    key,
    label,
    total: results.length,
    wins,
    losses,
    draws,
    decisive,
    record: `${wins}-${losses}${draws ? `-${draws}` : ""}`,
    winRate,
    winRateLabel: results.length ? `${winRate}%` : "No data"
  };
}

function normalizeSection(
  entries: DeckEntry[],
  section: DeckInsightCard["section"],
  registry: RegistryLookup
): DeckInsightCard[] {
  const merged = new Map<string, DeckInsightCard>();
  for (const entry of entries) {
    const card = normalizeCard(entry, section, registry);
    if (!card) continue;
    // Alternate, signed and reprint rows can carry unrelated print codes while
    // still representing the same playable card. Within one deck section the
    // canonical display name is therefore the safest copy-count identity.
    const mergeKey = normalized(card.name) || card.key;
    const existing = merged.get(mergeKey);
    if (!existing) {
      merged.set(mergeKey, card);
      continue;
    }
    existing.qty += card.qty;
    if (!existing.imageUrl && card.imageUrl) existing.imageUrl = card.imageUrl;
    if (!existing.cardId && card.cardId) existing.cardId = card.cardId;
    if (!existing.type && card.type) existing.type = card.type;
    if (!existing.supertype && card.supertype) existing.supertype = card.supertype;
    if (existing.costEnergy === null && card.costEnergy !== null) existing.costEnergy = card.costEnergy;
    if (existing.costPower === null && card.costPower !== null) existing.costPower = card.costPower;
  }
  return [...merged.values()]
    .sort((left, right) => (left.costEnergy ?? 99) - (right.costEnergy ?? 99) || left.name.localeCompare(right.name));
}

function normalizeCard(
  entry: DeckEntry | undefined,
  section: DeckInsightCard["section"],
  registry: RegistryLookup
): DeckInsightCard | null {
  if (!entry?.name?.trim()) return null;
  const registryCard = resolveRegistryCard(entry, registry);
  const cardId = registryCard?.code || entry.cardId || "";
  return {
    key: normalized(riftboundBasePrintCode(cardId) || cardId || entry.name),
    name: registryCard?.name || entry.name.trim(),
    cardId,
    imageUrl: entry.imageUrl || registryCard?.imageUrl || "",
    qty: Math.max(1, Math.trunc(Number(entry.qty) || 1)),
    section,
    type: registryCard?.type || sectionLabel(section),
    supertype: registryCard?.supertype || "",
    // Auto-imported TCGA snapshots historically persisted missing costs as zero.
    // Prefer the packaged registry whenever the card resolves so a missing value
    // cannot collapse the entire curve into the zero-cost bucket.
    costEnergy: finiteCost(registryCard?.costEnergy) ?? finiteCost(entry.costEnergy),
    costPower: finiteCost(registryCard?.costPower) ?? finiteCost(entry.costPower)
  };
}

type RegistryLookup = {
  byCode: Map<string, MulliganLabRegistryCard>;
  byName: Map<string, MulliganLabRegistryCard>;
};

function buildRegistryLookup(cards: Iterable<MulliganLabRegistryCard>): RegistryLookup {
  const byCode = new Map<string, MulliganLabRegistryCard>();
  const byName = new Map<string, MulliganLabRegistryCard>();
  for (const card of cards) {
    for (const alias of riftboundCardCodeAliases(card.code)) byCode.set(normalized(alias), card);
    byCode.set(normalized(riftboundBasePrintCode(card.code)), card);
    if (!byName.has(normalized(card.name))) byName.set(normalized(card.name), card);
  }
  return { byCode, byName };
}

function resolveRegistryCard(entry: DeckEntry, registry: RegistryLookup): MulliganLabRegistryCard | undefined {
  for (const candidate of [entry.cardId, riftboundBasePrintCode(entry.cardId ?? "")]) {
    const card = registry.byCode.get(normalized(candidate));
    if (card) return card;
  }
  return registry.byName.get(normalized(entry.name));
}

function parseExtraSnapshotSections(snapshotJson: string): { champions: DeckEntry[]; legendEntry?: DeckEntry } {
  try {
    const parsed = JSON.parse(snapshotJson) as Record<string, unknown>;
    const championSource = Array.isArray(parsed.champions)
      ? parsed.champions
      : Array.isArray(parsed.champion)
        ? parsed.champion
        : parsed.champion && typeof parsed.champion === "object"
          ? [parsed.champion]
          : [];
    return {
      champions: championSource.map(readLooseDeckEntry).filter((entry): entry is DeckEntry => Boolean(entry)),
      legendEntry: readLooseDeckEntry(parsed.legendEntry ?? parsed.legend_entry)
    };
  } catch {
    return { champions: [] };
  }
}

function readLooseDeckEntry(value: unknown): DeckEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const name = String(record.name ?? record.cardName ?? record.card_name ?? record.title ?? "").trim();
  if (!name) return undefined;
  return {
    qty: Math.max(1, Math.trunc(Number(record.qty ?? record.quantity ?? record.count ?? 1) || 1)),
    name,
    cardId: String(record.cardId ?? record.card_id ?? record.code ?? "").trim(),
    imageUrl: String(record.imageUrl ?? record.image_url ?? record.image ?? "").trim(),
    costEnergy: finiteCost(record.costEnergy ?? record.cost_energy) ?? undefined,
    costPower: finiteCost(record.costPower ?? record.cost_power) ?? undefined
  };
}

function sectionLabel(section: DeckInsightCard["section"]): string {
  if (section === "main") return "Card";
  return section.charAt(0).toUpperCase() + section.slice(1);
}

function finiteCost(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sumCopies(cards: Array<{ qty: number }>): number {
  return cards.reduce((sum, card) => sum + card.qty, 0);
}

function completedDeckGameNumbers(match: MatchDraft): number[] {
  return uniqueNumbers(
    match.games
      .filter((game) => game.result !== "Incomplete" && game.gameNumber >= 1 && game.gameNumber <= 3)
      .map((game) => game.gameNumber)
  );
}

function deckEntryIdentityKeys(entry: DeckEntry): string[] {
  return [entry.cardId, riftboundBasePrintCode(entry.cardId ?? ""), entry.name]
    .map(normalized)
    .filter(Boolean);
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function normalized(value: string | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function safeTime(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
