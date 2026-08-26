import type { ReplayRecord, ReplayStructuredCard, ReplayStructuredEvent } from "../shared/types.js";

export const INSIGHT_ANALYSIS_CACHE_STORAGE_KEY = "riftlite:insight-analysis-cache:v1";
export const INSIGHT_ANALYSIS_CACHE_SCHEMA_VERSION = 1 as const;
export const INSIGHT_ANALYSIS_DERIVATION_VERSION = 3 as const;

export interface InsightAnalysisCacheLimits {
  maxEntries: number;
  maxEventsPerEntry: number;
  maxTotalEvents: number;
  maxEntryCharacters: number;
  maxSerializedCharacters: number;
}

export const DEFAULT_INSIGHT_ANALYSIS_CACHE_LIMITS: Readonly<InsightAnalysisCacheLimits> = Object.freeze({
  // Entry count is intentionally generous so a normal long-running installation does not
  // churn through historical captures. Event and serialized-size caps remain the hard guards.
  maxEntries: 256,
  maxEventsPerEntry: 1_500,
  maxTotalEvents: 10_000,
  maxEntryCharacters: 750_000,
  maxSerializedCharacters: 3_500_000
});

export interface InsightAnalysisCacheEntry {
  replayId: string;
  fingerprint: string;
  analysisVersion: number;
  storedAt: number;
  lastAccessedAt: number;
  events: ReplayStructuredEvent[];
}

export interface InsightAnalysisCacheDocument {
  version: typeof INSIGHT_ANALYSIS_CACHE_SCHEMA_VERSION;
  entries: InsightAnalysisCacheEntry[];
}

export interface InsightAnalysisCacheLookup {
  cache: InsightAnalysisCacheDocument;
  hit: boolean;
  events?: ReplayStructuredEvent[];
}

export interface InsightAnalysisCacheBatchLookupResult {
  replayId: string;
  fingerprint: string;
  hit: boolean;
  events?: ReplayStructuredEvent[];
}

export interface InsightAnalysisCacheBatchLookup {
  cache: InsightAnalysisCacheDocument;
  results: InsightAnalysisCacheBatchLookupResult[];
  hits: number;
}

export interface InsightAnalysisCacheUpdate {
  cache: InsightAnalysisCacheDocument;
  stored: boolean;
  evictedEntries: number;
  reason?: "invalid-events" | "entry-too-large";
}

export interface InsightAnalysisCacheBatchStoreItem {
  replay: ReplayRecord;
  events: readonly ReplayStructuredEvent[];
}

export interface InsightAnalysisCacheBatchStoreResult {
  replayId: string;
  fingerprint: string;
  stored: boolean;
  reason?: "invalid-events" | "entry-too-large" | "superseded";
}

export interface InsightAnalysisCacheBatchUpdate {
  cache: InsightAnalysisCacheDocument;
  results: InsightAnalysisCacheBatchStoreResult[];
  storedEntries: number;
  evictedEntries: number;
}

export interface InsightAnalysisCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createEmptyInsightAnalysisCache(): InsightAnalysisCacheDocument {
  return { version: INSIGHT_ANALYSIS_CACHE_SCHEMA_VERSION, entries: [] };
}

/**
 * Raw capture enrichment only fills evidence that the durable structured replay does not
 * already provide. A multi-game replay is considered complete only when every known game has
 * a local opening-hand decision, at least one named local play, and the exact chosen-Champion
 * role. This is deliberately conservative: uncertain or partial base history still gets one
 * local raw-payload pass.
 */
export function replayNeedsRawInsightEnrichment(replay: ReplayRecord): boolean {
  if (replay.deletedAt || !replay.rawCapture) return false;
  const structuredEvents = replay.structuredEvents ?? [];
  if (!structuredEvents.length) return true;
  const knownGames = new Set<number>();
  for (const game of replay.matchSnapshot?.games ?? []) {
    if (Number.isFinite(game.gameNumber) && game.gameNumber > 0) knownGames.add(game.gameNumber);
  }
  for (const event of structuredEvents) {
    if (Number.isFinite(event.gameNumber) && event.gameNumber > 0) knownGames.add(event.gameNumber);
  }
  if (!knownGames.size) knownGames.add(1);
  for (const gameNumber of knownGames) {
    const hasOpeningHand = structuredEvents.some((event) => (
      event.gameNumber === gameNumber
        && event.type === "mulligan"
        && isAuthoritativeBaseEvent(event)
        && Boolean(event.mulligan?.kept?.length)
        && event.mulligan!.kept!.every((card) => isNamedCard(card.name))
    ));
    const hasNamedLocalPlay = structuredEvents.some((event) => (
      event.gameNumber === gameNumber
        && event.type === "play"
        && event.side === "me"
        && isAuthoritativeBaseEvent(event)
        && isNamedCard(event.cardName)
    ));
    const hasChosenChampionIdentity = structuredEvents.some((event) => (
      event.gameNumber === gameNumber
        && event.side === "me"
        && isNamedCard(event.cardName || event.cardId || "")
        && [event.fromZone, event.toZone, event.destination].some(isChosenChampionZone)
    ));
    if (!hasOpeningHand || !hasNamedLocalPlay || !hasChosenChampionIdentity) return true;
  }
  return false;
}

/**
 * Fingerprints every replay field that can change raw-event derivation. The replay id is
 * deliberately kept outside the hash as a separate cache identity component.
 */
export function createInsightAnalysisReplayFingerprint(replay: ReplayRecord): string {
  const raw = replay.rawCapture;
  const snapshot = replay.matchSnapshot;
  const identity = JSON.stringify([
    INSIGHT_ANALYSIS_DERIVATION_VERSION,
    replay.schemaVersion ?? 0,
    replay.matchId,
    replay.platform,
    replay.capturedAt,
    replay.title,
    replay.players.me,
    replay.players.opponent,
    snapshot?.myChampion ?? "",
    snapshot?.opponentChampion ?? "",
    snapshot?.format ?? "",
    raw?.provider ?? "",
    raw?.captureSessionId ?? "",
    raw?.checksumSha256 ?? "",
    raw?.messageCount ?? 0,
    raw?.firstSeenAt ?? 0,
    raw?.lastSeenAt ?? 0,
    raw?.captureCompletedAt ?? "",
    raw?.compressedBytes ?? 0,
    raw?.localPath ?? ""
  ]);
  return "d" + INSIGHT_ANALYSIS_DERIVATION_VERSION + "-" + fnv1a(identity);
}

export function parseInsightAnalysisCache(
  raw: string | null | undefined,
  limits: Partial<InsightAnalysisCacheLimits> = {}
): InsightAnalysisCacheDocument {
  if (!raw) return createEmptyInsightAnalysisCache();
  const resolved = resolveLimits(limits);
  if (raw.length > resolved.maxSerializedCharacters * 2) return createEmptyInsightAnalysisCache();
  try {
    const parsed: unknown = JSON.parse(raw);
    const migrated = migrateCacheDocument(parsed);
    return migrated ? pruneInsightAnalysisCache(migrated, resolved) : createEmptyInsightAnalysisCache();
  } catch {
    return createEmptyInsightAnalysisCache();
  }
}

export function serializeInsightAnalysisCache(
  cache: InsightAnalysisCacheDocument,
  limits: Partial<InsightAnalysisCacheLimits> = {}
): string {
  return JSON.stringify(pruneInsightAnalysisCache(cache, limits));
}

export function loadInsightAnalysisCache(
  storage: InsightAnalysisCacheStorage,
  limits: Partial<InsightAnalysisCacheLimits> = {}
): InsightAnalysisCacheDocument {
  try {
    return parseInsightAnalysisCache(storage.getItem(INSIGHT_ANALYSIS_CACHE_STORAGE_KEY), limits);
  } catch {
    return createEmptyInsightAnalysisCache();
  }
}

export function persistInsightAnalysisCache(
  storage: InsightAnalysisCacheStorage,
  cache: InsightAnalysisCacheDocument,
  limits: Partial<InsightAnalysisCacheLimits> = {}
): boolean {
  try {
    storage.setItem(INSIGHT_ANALYSIS_CACHE_STORAGE_KEY, serializeInsightAnalysisCache(cache, limits));
    return true;
  } catch {
    return false;
  }
}

export function lookupInsightAnalysisEvents(
  cache: InsightAnalysisCacheDocument,
  replay: ReplayRecord,
  accessedAt = Date.now(),
  limits: Partial<InsightAnalysisCacheLimits> = {}
): InsightAnalysisCacheLookup {
  const batch = lookupInsightAnalysisEventsBatch(cache, [replay], accessedAt, limits);
  const result = batch.results[0];
  return result?.hit
    ? { cache: batch.cache, hit: true, events: result.events }
    : { cache: batch.cache, hit: false };
}

/**
 * Looks up and touches many replay identities with one validation, sort and prune pass.
 * Results preserve replay input order and an empty events array remains an explicit hit.
 */
export function lookupInsightAnalysisEventsBatch(
  cache: InsightAnalysisCacheDocument,
  replays: readonly ReplayRecord[],
  accessedAt = Date.now(),
  limits: Partial<InsightAnalysisCacheLimits> = {}
): InsightAnalysisCacheBatchLookup {
  const requests = replays.map((replay) => ({
    replayId: replay.id,
    fingerprint: createInsightAnalysisReplayFingerprint(replay)
  }));
  const requestedIdentities = new Set(requests.map((request) => cacheEntryIdentity(request)));
  const touchTimestamp = typeof accessedAt === "number" && Number.isFinite(accessedAt) ? accessedAt : null;
  const prepared = prepareInsightAnalysisCacheEntries(cache).map((candidate) => {
    if (!requestedIdentities.has(cacheEntryIdentity(candidate.entry)) || touchTimestamp == null) return candidate;
    const entry = { ...candidate.entry, lastAccessedAt: touchTimestamp };
    const entryCharacters = serializedLength(entry);
    return { ...candidate, entry, entryCharacters };
  });
  const next = selectPreparedInsightAnalysisCacheEntries(prepared, resolveLimits(limits));
  const byIdentity = new Map(next.entries.map((entry) => [cacheEntryIdentity(entry), entry]));
  const results = requests.map((request): InsightAnalysisCacheBatchLookupResult => {
    const entry = byIdentity.get(cacheEntryIdentity(request));
    return entry
      ? { ...request, hit: true, events: entry.events }
      : { ...request, hit: false };
  });
  return {
    cache: next,
    results,
    hits: results.filter((result) => result.hit).length
  };
}

export function cacheInsightAnalysisEvents(
  cache: InsightAnalysisCacheDocument,
  replay: ReplayRecord,
  events: readonly ReplayStructuredEvent[],
  options: {
    now?: number;
    limits?: Partial<InsightAnalysisCacheLimits>;
  } = {}
): InsightAnalysisCacheUpdate {
  const batch = cacheInsightAnalysisEventsBatch(cache, [{ replay, events }], options);
  const result = batch.results[0];
  return {
    cache: batch.cache,
    stored: result?.stored ?? false,
    evictedEntries: batch.evictedEntries,
    reason: result?.reason === "invalid-events" ? "invalid-events" : result?.stored ? undefined : "entry-too-large"
  };
}


/**
 * Stores a set of replay derivations with one existing-cache validation and one selection pass.
 * The final occurrence wins when a replay id appears more than once in the same batch.
 */
export function cacheInsightAnalysisEventsBatch(
  cache: InsightAnalysisCacheDocument,
  items: readonly InsightAnalysisCacheBatchStoreItem[],
  options: {
    now?: number;
    limits?: Partial<InsightAnalysisCacheLimits>;
  } = {}
): InsightAnalysisCacheBatchUpdate {
  const limits = resolveLimits(options.limits ?? {});
  const now = finiteTimestamp(options.now, Date.now());
  const lastIndexByReplayId = new Map<string, number>();
  items.forEach((item, index) => lastIndexByReplayId.set(item.replay.id, index));
  const attemptedReplayIds = new Set(items.map((item) => item.replay.id));
  const existing = prepareInsightAnalysisCacheEntries(cache);
  const retainedExistingCandidates = existing.filter((candidate) => !attemptedReplayIds.has(candidate.entry.replayId));
  const preparedCandidates: PreparedInsightAnalysisCacheEntry[] = [];
  const provisional = items.map((item, index): InsightAnalysisCacheBatchStoreResult => {
    const fingerprint = createInsightAnalysisReplayFingerprint(item.replay);
    const base = { replayId: item.replay.id, fingerprint };
    if (lastIndexByReplayId.get(item.replay.id) !== index) {
      return { ...base, stored: false, reason: "superseded" };
    }
    if (!Array.isArray(item.events) || !item.events.every(isReplayStructuredEvent)) {
      return { ...base, stored: false, reason: "invalid-events" };
    }
    const events = item.events.slice();
    const eventCharacters = serializedLength(events);
    if (events.length > limits.maxEventsPerEntry || eventCharacters > limits.maxEntryCharacters) {
      return { ...base, stored: false, reason: "entry-too-large" };
    }
    const entry: InsightAnalysisCacheEntry = {
      replayId: item.replay.id,
      fingerprint,
      analysisVersion: INSIGHT_ANALYSIS_DERIVATION_VERSION,
      storedAt: now,
      lastAccessedAt: now,
      events
    };
    const entryCharacters = serializedLength(entry);
    if (!Number.isFinite(entryCharacters)) return { ...base, stored: false, reason: "entry-too-large" };
    preparedCandidates.push({ entry, eventCharacters, entryCharacters });
    return { ...base, stored: false };
  });
  const next = selectPreparedInsightAnalysisCacheEntries(
    [...preparedCandidates, ...retainedExistingCandidates],
    limits
  );
  const storedIdentities = new Set(next.entries.map(cacheEntryIdentity));
  const results = provisional.map((result): InsightAnalysisCacheBatchStoreResult => {
    if (result.reason) return result;
    const stored = storedIdentities.has(cacheEntryIdentity(result));
    return stored ? { ...result, stored: true } : { ...result, stored: false, reason: "entry-too-large" };
  });
  const retainedExistingIdentities = new Set(retainedExistingCandidates.map((candidate) => cacheEntryIdentity(candidate.entry)));
  const selectedExistingIdentities = new Set(next.entries
    .map(cacheEntryIdentity)
    .filter((identity) => retainedExistingIdentities.has(identity)));
  return {
    cache: next,
    results,
    storedEntries: results.filter((result) => result.stored).length,
    evictedEntries: Math.max(0, retainedExistingIdentities.size - selectedExistingIdentities.size)
  };
}

export function pruneInsightAnalysisCache(
  cache: InsightAnalysisCacheDocument,
  limits: Partial<InsightAnalysisCacheLimits> = {}
): InsightAnalysisCacheDocument {
  return selectPreparedInsightAnalysisCacheEntries(
    prepareInsightAnalysisCacheEntries(cache),
    resolveLimits(limits)
  );
}

interface PreparedInsightAnalysisCacheEntry {
  entry: InsightAnalysisCacheEntry;
  eventCharacters: number;
  entryCharacters: number;
}

function prepareInsightAnalysisCacheEntries(
  cache: InsightAnalysisCacheDocument
): PreparedInsightAnalysisCacheEntry[] {
  if (!Array.isArray(cache?.entries)) return [];
  return cache.entries
    .map(prepareInsightAnalysisCacheEntry)
    .filter((entry): entry is PreparedInsightAnalysisCacheEntry => Boolean(entry));
}

function prepareInsightAnalysisCacheEntry(value: unknown): PreparedInsightAnalysisCacheEntry | null {
  if (!isCacheEntry(value)) return null;
  const entry: InsightAnalysisCacheEntry = {
    replayId: value.replayId.trim(),
    fingerprint: value.fingerprint.trim(),
    analysisVersion: positiveInteger(value.analysisVersion, INSIGHT_ANALYSIS_DERIVATION_VERSION),
    storedAt: value.storedAt,
    lastAccessedAt: value.lastAccessedAt,
    events: value.events
  };
  const eventCharacters = serializedLength(entry.events);
  const entryCharacters = serializedLength(entry);
  if (!Number.isFinite(eventCharacters) || !Number.isFinite(entryCharacters)) return null;
  return { entry, eventCharacters, entryCharacters };
}

function selectPreparedInsightAnalysisCacheEntries(
  candidates: PreparedInsightAnalysisCacheEntry[],
  resolved: InsightAnalysisCacheLimits
): InsightAnalysisCacheDocument {
  candidates.sort((left, right) => compareNewestFirst(left.entry, right.entry));
  const selected: InsightAnalysisCacheEntry[] = [];
  const identities = new Set<string>();
  let totalEvents = 0;
  let serializedCharacters = serializedLength(createEmptyInsightAnalysisCache());
  for (const candidate of candidates) {
    const { entry, eventCharacters, entryCharacters } = candidate;
    const identity = cacheEntryIdentity(entry);
    if (identities.has(identity)) continue;
    if (entry.events.length > resolved.maxEventsPerEntry) continue;
    if (eventCharacters > resolved.maxEntryCharacters) continue;
    if (selected.length >= resolved.maxEntries) continue;
    if (totalEvents + entry.events.length > resolved.maxTotalEvents) continue;
    const nextSerializedCharacters = serializedCharacters + entryCharacters + (selected.length ? 1 : 0);
    if (nextSerializedCharacters > resolved.maxSerializedCharacters) continue;
    identities.add(identity);
    selected.push(entry);
    totalEvents += entry.events.length;
    serializedCharacters = nextSerializedCharacters;
  }
  return { version: INSIGHT_ANALYSIS_CACHE_SCHEMA_VERSION, entries: selected };
}

export async function mapWithConcurrency<T, Result>(
  items: readonly T[],
  requestedConcurrency: number,
  mapper: (item: T, index: number) => Promise<Result> | Result
): Promise<Result[]> {
  if (!items.length) return [];
  const concurrency = Math.min(items.length, positiveInteger(requestedConcurrency, 1));
  const results = new Array<Result>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function migrateCacheDocument(value: unknown): InsightAnalysisCacheDocument | null {
  if (!isRecord(value)) return null;
  if (value.version !== undefined && value.version !== 0 && value.version !== INSIGHT_ANALYSIS_CACHE_SCHEMA_VERSION) return null;
  const rawEntries = Array.isArray(value.entries)
    ? value.entries
    : isRecord(value.entries)
      ? Object.entries(value.entries).map(([identity, entry]) => migrateKeyedEntry(identity, entry))
      : [];
  const entries = rawEntries
    .map(migrateCacheEntry)
    .filter((entry): entry is InsightAnalysisCacheEntry => Boolean(entry));
  return { version: INSIGHT_ANALYSIS_CACHE_SCHEMA_VERSION, entries };
}

function migrateKeyedEntry(identity: string, value: unknown): unknown {
  if (!isRecord(value)) return value;
  const separator = identity.lastIndexOf("::");
  return {
    ...value,
    replayId: typeof value.replayId === "string" ? value.replayId : separator >= 0 ? identity.slice(0, separator) : "",
    fingerprint: typeof value.fingerprint === "string" ? value.fingerprint : separator >= 0 ? identity.slice(separator + 2) : ""
  };
}

function migrateCacheEntry(value: unknown): InsightAnalysisCacheEntry | null {
  if (!isRecord(value)) return null;
  const replayId = typeof value.replayId === "string" ? value.replayId.trim() : "";
  const fingerprint = typeof value.fingerprint === "string" ? value.fingerprint.trim() : "";
  const events = Array.isArray(value.events) && value.events.every(isReplayStructuredEvent)
    ? value.events as ReplayStructuredEvent[]
    : null;
  if (!replayId || !fingerprint || !events) return null;
  const storedAt = parseTimestamp(value.storedAt ?? value.updatedAt ?? value.createdAt);
  const lastAccessedAt = parseTimestamp(value.lastAccessedAt ?? value.accessedAt ?? storedAt);
  return {
    replayId,
    fingerprint,
    analysisVersion: positiveInteger(value.analysisVersion, INSIGHT_ANALYSIS_DERIVATION_VERSION),
    storedAt,
    lastAccessedAt,
    events
  };
}

function isCacheEntry(value: unknown): value is InsightAnalysisCacheEntry {
  if (!isRecord(value)) return false;
  return typeof value.replayId === "string"
    && Boolean(value.replayId.trim())
    && typeof value.fingerprint === "string"
    && Boolean(value.fingerprint.trim())
    && Number.isFinite(value.analysisVersion)
    && Number.isFinite(value.storedAt)
    && Number.isFinite(value.lastAccessedAt)
    && Array.isArray(value.events)
    && value.events.every(isReplayStructuredEvent);
}

function isReplayStructuredEvent(value: unknown): value is ReplayStructuredEvent {
  if (!isRecord(value)) return false;
  const types = new Set([
    "setup", "mulligan", "turn-start", "turn-end", "play", "move", "draw",
    "score", "combat", "result", "action", "scoreboard", "battlefield"
  ]);
  const sides = new Set(["me", "opponent", "system", "unknown"]);
  if (typeof value.id !== "string" || typeof value.sourceEventId !== "string") return false;
  if (!Number.isFinite(value.gameNumber) || (value.gameNumber as number) < 1) return false;
  if (typeof value.capturedAt !== "string" || typeof value.labelTime !== "string") return false;
  if (typeof value.type !== "string" || !types.has(value.type)) return false;
  if (typeof value.side !== "string" || !sides.has(value.side)) return false;
  if (typeof value.text !== "string" || typeof value.cardName !== "string") return false;
  if (typeof value.destination !== "string" || typeof value.battlefield !== "string") return false;
  if (value.mulligan !== undefined) {
    if (!isRecord(value.mulligan)) return false;
    for (const key of ["options", "kept", "redrawn"] as const) {
      const cards = value.mulligan[key];
      if (cards !== undefined && (!Array.isArray(cards) || !cards.every(isReplayStructuredCard))) return false;
    }
    if (value.mulligan.redrawCount !== undefined && !Number.isFinite(value.mulligan.redrawCount)) return false;
  }
  for (const key of ["resource", "counter", "token", "combat", "snapshot"] as const) {
    if (value[key] !== undefined && !isRecord(value[key])) return false;
  }
  return true;
}

function isReplayStructuredCard(value: unknown): value is ReplayStructuredCard {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.code === "string"
    && typeof value.type === "string"
    && typeof value.imageUrl === "string";
}

function isAuthoritativeBaseEvent(event: ReplayStructuredEvent): boolean {
  return event.actionId !== "insight:raw-authoritative"
    && !event.id.startsWith("raw-opening:")
    && !event.id.startsWith("raw-action:");
}

function isNamedCard(value: string): boolean {
  const name = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!name || /^(?:unknown|known) card$/.test(name)) return false;
  if (/^(?:a|an|\d+) cards?(?: from .+)?$/.test(name)) return false;
  return !/^cards?(?: from .+)?$/.test(name);
}

function isChosenChampionZone(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const zone = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return zone === "champion" || zone === "chosen-champion" || zone === "selected-champion";
}

function resolveLimits(overrides: Partial<InsightAnalysisCacheLimits>): InsightAnalysisCacheLimits {
  return {
    maxEntries: positiveInteger(overrides.maxEntries, DEFAULT_INSIGHT_ANALYSIS_CACHE_LIMITS.maxEntries),
    maxEventsPerEntry: positiveInteger(overrides.maxEventsPerEntry, DEFAULT_INSIGHT_ANALYSIS_CACHE_LIMITS.maxEventsPerEntry),
    maxTotalEvents: positiveInteger(overrides.maxTotalEvents, DEFAULT_INSIGHT_ANALYSIS_CACHE_LIMITS.maxTotalEvents),
    maxEntryCharacters: positiveInteger(overrides.maxEntryCharacters, DEFAULT_INSIGHT_ANALYSIS_CACHE_LIMITS.maxEntryCharacters),
    maxSerializedCharacters: positiveInteger(overrides.maxSerializedCharacters, DEFAULT_INSIGHT_ANALYSIS_CACHE_LIMITS.maxSerializedCharacters)
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function compareNewestFirst(left: InsightAnalysisCacheEntry, right: InsightAnalysisCacheEntry): number {
  return right.lastAccessedAt - left.lastAccessedAt || right.storedAt - left.storedAt;
}

function cacheEntryIdentity(value: Pick<InsightAnalysisCacheEntry, "replayId" | "fingerprint">): string {
  return value.replayId + "\u0000" + value.fingerprint;
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}
