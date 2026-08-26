import { describe, expect, it } from "vitest";
import {
  INSIGHT_ANALYSIS_CACHE_SCHEMA_VERSION,
  INSIGHT_ANALYSIS_CACHE_STORAGE_KEY,
  cacheInsightAnalysisEvents,
  cacheInsightAnalysisEventsBatch,
  createEmptyInsightAnalysisCache,
  createInsightAnalysisReplayFingerprint,
  loadInsightAnalysisCache,
  lookupInsightAnalysisEvents,
  lookupInsightAnalysisEventsBatch,
  mapWithConcurrency,
  parseInsightAnalysisCache,
  persistInsightAnalysisCache,
  pruneInsightAnalysisCache,
  replayNeedsRawInsightEnrichment,
  serializeInsightAnalysisCache
} from "../src/renderer/insightAnalysisCache.js";
import type { ReplayRecord, ReplayStructuredEvent } from "../src/shared/types.js";

const START = "2026-08-25T10:00:00.000Z";

function replay(id: string, patch: Partial<ReplayRecord> = {}): ReplayRecord {
  return {
    id,
    matchId: "match-" + id,
    platform: "atlas",
    capturedAt: START,
    title: "Ahri vs Jinx",
    players: { me: "Learner", opponent: "Opponent" },
    events: [],
    rawCapture: {
      provider: "riftlite-v2",
      captureSessionId: "session-" + id,
      messageCount: 100,
      lastSeenAt: 1000,
      uploadStatus: "not-uploaded",
      localPath: "C:/captures/" + id + ".jsonl"
    },
    ...patch
  };
}

function event(id: string): ReplayStructuredEvent {
  return {
    id,
    sourceEventId: "source-" + id,
    gameNumber: 1,
    capturedAt: START,
    labelTime: "10:00",
    type: "play",
    side: "me",
    text: "Played Test Card",
    cardName: "Test Card",
    destination: "board",
    battlefield: ""
  };
}

describe("Insights analysis cache", () => {
  it("skips raw enrichment only when every known game has authoritative opening and play evidence", () => {
    const source = replay("coverage");
    expect(replayNeedsRawInsightEnrichment(source)).toBe(true);

    const opening: ReplayStructuredEvent = {
      ...event("opening"),
      type: "mulligan",
      cardName: "",
      mulligan: {
        kept: [{ id: "card-1", code: "TST-001", name: "Patient Guardian", type: "unit", imageUrl: "" }],
        redrawCount: 2
      }
    };
    const play: ReplayStructuredEvent = { ...event("named-play"), cardName: "Patient Guardian" };
    const chosenChampion: ReplayStructuredEvent = {
      ...event("chosen-champion"),
      type: "setup",
      cardName: "Akali, Deadly Weapon",
      cardId: "VEN-021",
      destination: "Chosen_Champion",
      toZone: "Chosen_Champion"
    };
    expect(replayNeedsRawInsightEnrichment({ ...source, structuredEvents: [opening, play, chosenChampion] })).toBe(false);

    const secondGameOpening: ReplayStructuredEvent = { ...opening, id: "game-two-opening", gameNumber: 2 };
    expect(replayNeedsRawInsightEnrichment({
      ...source,
      structuredEvents: [opening, play, chosenChampion, secondGameOpening]
    })).toBe(true);

    expect(replayNeedsRawInsightEnrichment({
      ...source,
      structuredEvents: [opening, chosenChampion, { ...play, id: "raw-action:" + source.id, actionId: "insight:raw-authoritative" }]
    })).toBe(true);
    expect(replayNeedsRawInsightEnrichment({ ...source, rawCapture: undefined })).toBe(false);
  });

  it("builds a stable replay fingerprint and invalidates it when derivation inputs change", () => {
    const source = replay("one");
    const fingerprint = createInsightAnalysisReplayFingerprint(source);
    expect(createInsightAnalysisReplayFingerprint({ ...source })).toBe(fingerprint);
    expect(createInsightAnalysisReplayFingerprint({
      ...source,
      rawCapture: { ...source.rawCapture!, messageCount: 101 }
    })).not.toBe(fingerprint);
    expect(createInsightAnalysisReplayFingerprint({
      ...source,
      players: { ...source.players, me: "Renamed learner" }
    })).not.toBe(fingerprint);
  });

  it("safely discards malformed and unsupported cache documents", () => {
    expect(parseInsightAnalysisCache("not-json")).toEqual(createEmptyInsightAnalysisCache());
    expect(parseInsightAnalysisCache(JSON.stringify({ version: 999, entries: [] }))).toEqual(createEmptyInsightAnalysisCache());
    expect(parseInsightAnalysisCache(JSON.stringify({ version: 1, entries: [{ replayId: "bad" }] }))).toEqual(createEmptyInsightAnalysisCache());
  });

  it("migrates an unversioned keyed cache and removes invalid entries", () => {
    const source = replay("legacy");
    const fingerprint = createInsightAnalysisReplayFingerprint(source);
    const identity = source.id + "::" + fingerprint;
    const migrated = parseInsightAnalysisCache(JSON.stringify({
      entries: {
        [identity]: { updatedAt: START, events: [event("valid")] },
        "broken::entry": { updatedAt: START, events: [{ id: "incomplete" }] }
      }
    }));
    expect(migrated.version).toBe(INSIGHT_ANALYSIS_CACHE_SCHEMA_VERSION);
    expect(migrated.entries).toHaveLength(1);
    expect(migrated.entries[0]).toMatchObject({ replayId: source.id, fingerprint });
    expect(migrated.entries[0]?.events.map((item) => item.id)).toEqual(["valid"]);
  });

  it("round-trips hits, including an intentionally empty derived result", () => {
    const source = replay("empty");
    const stored = cacheInsightAnalysisEvents(createEmptyInsightAnalysisCache(), source, [], { now: 10 });
    expect(stored.stored).toBe(true);
    const parsed = parseInsightAnalysisCache(serializeInsightAnalysisCache(stored.cache));
    const lookup = lookupInsightAnalysisEvents(parsed, source, 20);
    expect(lookup.hit).toBe(true);
    expect(lookup.events).toEqual([]);
    expect(lookup.cache.entries[0]?.lastAccessedAt).toBe(20);
  });

  it("batch stores and looks up ordered results, including empty-event hits", () => {
    const empty = replay("batch-empty");
    const filled = replay("batch-filled");
    const missing = replay("batch-missing");
    const stored = cacheInsightAnalysisEventsBatch(createEmptyInsightAnalysisCache(), [
      { replay: empty, events: [] },
      { replay: filled, events: [event("batch-play")] }
    ], { now: 10 });

    expect(stored.storedEntries).toBe(2);
    expect(stored.results.map((result) => result.stored)).toEqual([true, true]);

    const lookup = lookupInsightAnalysisEventsBatch(stored.cache, [filled, missing, empty], 20);
    expect(lookup.hits).toBe(2);
    expect(lookup.results.map((result) => result.hit)).toEqual([true, false, true]);
    expect(lookup.results[0]?.events?.map((item) => item.id)).toEqual(["batch-play"]);
    expect(lookup.results[1]?.events).toBeUndefined();
    expect(lookup.results[2]?.events).toEqual([]);
    expect(lookup.cache.entries
      .filter((entry) => entry.replayId === empty.id || entry.replayId === filled.id)
      .every((entry) => entry.lastAccessedAt === 20)).toBe(true);
  });

  it("batch storage rejects unsafe items, removes stale replacements, and lets the final duplicate win", () => {
    const limits = {
      maxEntries: 5,
      maxEventsPerEntry: 2,
      maxTotalEvents: 10,
      maxEntryCharacters: 100_000,
      maxSerializedCharacters: 200_000
    };
    const stale = replay("batch-stale");
    const retained = replay("batch-retained");
    const seed = cacheInsightAnalysisEventsBatch(createEmptyInsightAnalysisCache(), [
      { replay: stale, events: [event("stale-event")] },
      { replay: retained, events: [event("retained-event")] }
    ], { now: 1, limits });
    const invalid = { ...event("invalid-batch"), mulligan: { kept: ["unsafe"] } } as unknown as ReplayStructuredEvent;
    const duplicate = replay("batch-duplicate");
    const oversized = replay("batch-oversized");
    const update = cacheInsightAnalysisEventsBatch(seed.cache, [
      { replay: stale, events: [invalid] },
      { replay: oversized, events: [event("large-a"), event("large-b"), event("large-c")] },
      { replay: duplicate, events: [event("superseded")] },
      { replay: duplicate, events: [event("winning-duplicate")] }
    ], { now: 2, limits });

    expect(update.results.map((result) => ({ replayId: result.replayId, stored: result.stored, reason: result.reason }))).toEqual([
      { replayId: stale.id, stored: false, reason: "invalid-events" },
      { replayId: oversized.id, stored: false, reason: "entry-too-large" },
      { replayId: duplicate.id, stored: false, reason: "superseded" },
      { replayId: duplicate.id, stored: true, reason: undefined }
    ]);
    expect(update.storedEntries).toBe(1);
    expect(update.cache.entries.some((entry) => entry.replayId === stale.id)).toBe(false);
    expect(update.cache.entries.some((entry) => entry.replayId === retained.id)).toBe(true);
    expect(update.cache.entries.find((entry) => entry.replayId === duplicate.id)?.events[0]?.id).toBe("winning-duplicate");
  });

  it("misses after the replay fingerprint changes", () => {
    const source = replay("changed");
    const stored = cacheInsightAnalysisEvents(createEmptyInsightAnalysisCache(), source, [event("play")], { now: 10 });
    const changed = {
      ...source,
      rawCapture: { ...source.rawCapture!, checksumSha256: "new-checksum" }
    };
    expect(lookupInsightAnalysisEvents(stored.cache, changed).hit).toBe(false);
  });

  it("evicts the least recently used entry at the entry bound", () => {
    const limits = {
      maxEntries: 2,
      maxEventsPerEntry: 10,
      maxTotalEvents: 20,
      maxEntryCharacters: 100_000,
      maxSerializedCharacters: 200_000
    };
    const first = replay("first");
    const second = replay("second");
    const third = replay("third");
    let cache = cacheInsightAnalysisEvents(createEmptyInsightAnalysisCache(), first, [event("one")], { now: 1, limits }).cache;
    cache = cacheInsightAnalysisEvents(cache, second, [event("two")], { now: 2, limits }).cache;
    cache = lookupInsightAnalysisEvents(cache, first, 10, limits).cache;
    const update = cacheInsightAnalysisEvents(cache, third, [event("three")], { now: 3, limits });
    expect(update.cache.entries.map((entry) => entry.replayId)).toEqual(["first", "third"]);
    expect(update.evictedEntries).toBe(1);
  });

  it("evicts whole entries to enforce total events and never caches a partial replay", () => {
    const limits = {
      maxEntries: 10,
      maxEventsPerEntry: 2,
      maxTotalEvents: 3,
      maxEntryCharacters: 100_000,
      maxSerializedCharacters: 200_000
    };
    const first = cacheInsightAnalysisEvents(
      createEmptyInsightAnalysisCache(),
      replay("old"),
      [event("old-a"), event("old-b")],
      { now: 1, limits }
    );
    const second = cacheInsightAnalysisEvents(
      first.cache,
      replay("new"),
      [event("new-a"), event("new-b")],
      { now: 2, limits }
    );
    expect(second.cache.entries.map((entry) => entry.replayId)).toEqual(["new"]);

    const oversized = cacheInsightAnalysisEvents(
      second.cache,
      replay("large"),
      [event("a"), event("b"), event("c")],
      { now: 3, limits }
    );
    expect(oversized).toMatchObject({ stored: false, reason: "entry-too-large" });
    expect(oversized.cache.entries.some((entry) => entry.replayId === "large")).toBe(false);
  });

  it("enforces the serialized-character bound at the exact document boundary", () => {
    const sources = [replay("size-a"), replay("size-b")];
    const stored = cacheInsightAnalysisEventsBatch(createEmptyInsightAnalysisCache(), sources.map((source, index) => ({
      replay: source,
      events: [event(`size-event-${index}`)]
    })), { now: 1 });
    const exactLength = JSON.stringify(stored.cache).length;
    const generousLimits = {
      maxEntries: 10,
      maxEventsPerEntry: 10,
      maxTotalEvents: 20,
      maxEntryCharacters: 100_000
    };

    const exact = pruneInsightAnalysisCache(stored.cache, { ...generousLimits, maxSerializedCharacters: exactLength });
    const oneCharacterShort = pruneInsightAnalysisCache(stored.cache, {
      ...generousLimits,
      maxSerializedCharacters: exactLength - 1
    });

    expect(exact.entries).toHaveLength(2);
    expect(JSON.stringify(exact)).toHaveLength(exactLength);
    expect(oneCharacterShort.entries).toHaveLength(1);
    expect(JSON.stringify(oneCharacterShort).length).toBeLessThanOrEqual(exactLength - 1);
  });

  it("rejects structurally unsafe cached events", () => {
    const invalid = { ...event("bad"), mulligan: { kept: ["not-a-card"] } } as unknown as ReplayStructuredEvent;
    const result = cacheInsightAnalysisEvents(createEmptyInsightAnalysisCache(), replay("invalid"), [invalid]);
    expect(result).toMatchObject({ stored: false, reason: "invalid-events" });
    expect(result.cache.entries).toEqual([]);
  });

  it("contains storage failures without breaking Insights", () => {
    const failingStorage = {
      getItem(): string | null { throw new Error("blocked"); },
      setItem(): void { throw new Error("quota"); }
    };
    expect(loadInsightAnalysisCache(failingStorage)).toEqual(createEmptyInsightAnalysisCache());
    expect(persistInsightAnalysisCache(failingStorage, createEmptyInsightAnalysisCache())).toBe(false);

    let value = "";
    const storage = {
      getItem(key: string): string | null { return key === INSIGHT_ANALYSIS_CACHE_STORAGE_KEY ? value : null; },
      setItem(key: string, next: string): void { if (key === INSIGHT_ANALYSIS_CACHE_STORAGE_KEY) value = next; }
    };
    const cached = cacheInsightAnalysisEvents(createEmptyInsightAnalysisCache(), replay("stored"), [event("stored")]);
    expect(persistInsightAnalysisCache(storage, cached.cache)).toBe(true);
    expect(loadInsightAnalysisCache(storage).entries[0]?.replayId).toBe("stored");
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order while respecting the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([4, 3, 2, 1], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 10;
    });
    expect(results).toEqual([40, 30, 20, 10]);
    expect(peak).toBe(2);
  });

  it("uses one worker for an invalid bound and handles empty input", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3], 0, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return value;
    });
    expect(results).toEqual([1, 2, 3]);
    expect(peak).toBe(1);
    expect(await mapWithConcurrency([], 3, (value) => value)).toEqual([]);
  });
});
