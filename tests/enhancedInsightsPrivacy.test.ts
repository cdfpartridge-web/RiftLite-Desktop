import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeBackupFile } from "../src/main/services/backupSanitizer";
import { RiftLiteStore } from "../src/main/services/store.js";
import type { MatchDraft, ReplayRecord, RiftLiteBackupFile, UserSettings } from "../src/shared/types";

function match(id: string): MatchDraft {
  return {
    id,
    platform: "atlas",
    status: "saved",
    capturedAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:20:00.000Z",
    result: "Win",
    format: "Bo1",
    score: "8-4",
    myName: "Player",
    opponentName: "Opponent",
    myChampion: "Ahri",
    opponentChampion: "Jinx",
    myBattlefield: "",
    opponentBattlefield: "",
    deckName: "",
    deckSourceId: "",
    deckSourceKey: "",
    deckSourceUrl: "",
    deckSnapshotJson: "",
    flags: "",
    notes: "ordinary note",
    games: [],
    rawEvidence: [{
      id: `raw-${id}`,
      platform: "atlas",
      kind: "match-snapshot",
      capturedAt: "2026-09-01T10:05:00.000Z",
      url: "https://play.riftatlas.com/game",
      payload: { rows: [{ text: "Private source row" }] }
    }],
    insightContext: {
      version: 1,
      capturedWithEnhancedInsights: true,
      activeGoalIds: ["goal-1"],
      decisions: [{
        id: "decision-1",
        family: "resources",
        source: "live-flag",
        note: "private decision note",
        createdAt: "2026-09-01T10:05:00.000Z"
      }],
      updatedAt: "2026-09-01T10:20:00.000Z"
    },
    sync: { community: "disabled", hubs: {}, teams: {} }
  };
}

function settings(): UserSettings {
  return {
    activeHubs: [],
    activeTeams: [],
    rawCapture: {},
    firebaseRefreshToken: "",
    scorepadDeviceSecret: ""
  } as unknown as UserSettings;
}

describe("Enhanced Insights privacy boundaries", () => {
  it("keeps local insight context and enhanced semantic evidence out of automatic backups", () => {
    const savedMatch = match("match-1");
    const replay: ReplayRecord = {
      id: "replay-1",
      matchId: savedMatch.id,
      platform: "atlas",
      capturedAt: savedMatch.capturedAt,
      schemaVersion: 5,
      title: "Ahri vs Jinx",
      players: { me: "Player", opponent: "Opponent" },
      events: [...savedMatch.rawEvidence],
      structuredEvents: [{
        id: "semantic-1",
        capturedAt: "2026-09-01T10:05:00.000Z",
        labelTime: "05:00",
        type: "action",
        side: "me",
        text: "Paid two runes.",
        battlefield: ""
      }],
      flags: [{
        id: "enhanced-insight-decision-1",
        targetType: "replay",
        targetId: "replay-1",
        targetLabel: "Marked decision",
        label: "Review decision",
        note: "private marker",
        capturedAt: "2026-09-01T10:05:00.000Z",
        createdAt: "2026-09-01T10:05:00.000Z"
      }, {
        id: "ordinary-flag",
        targetType: "replay",
        targetId: "replay-1",
        targetLabel: "Replay",
        label: "Rules check",
        note: "ordinary replay note",
        capturedAt: "2026-09-01T10:06:00.000Z",
        createdAt: "2026-09-01T10:06:00.000Z"
      }],
      enhancedInsights: {
        version: 1,
        captured: true,
        capturedAt: savedMatch.capturedAt,
        captureMode: "semantic-local"
      },
      intelligence: {
        version: 1,
        generatedAt: savedMatch.capturedAt,
        sourceEventCount: 1,
        corrections: [{
          id: "correction-1",
          eventId: "semantic-1",
          updatedAt: savedMatch.capturedAt,
          note: "private correction note"
        }],
        coverage: {
          grade: "limited",
          totalEvents: 1,
          confirmed: 1,
          reconstructed: 0,
          inferred: 0,
          manual: 0,
          cardEvents: 1,
          scoreEvents: 0,
          turnEvents: 0,
          hasVideo: false
        },
        stats: {
          games: 1,
          turns: 0,
          cardActions: 1,
          draws: 0,
          plays: 1,
          moves: 0,
          scoringEvents: 0,
          combats: 0,
          battlefieldChanges: 0,
          mulligans: 0
        },
        story: ["private derived story"],
        moments: [{
          id: "moment-1",
          kind: "decision",
          title: "Private moment",
          body: "private derived detail",
          confidence: "confirmed"
        }],
        cardJourneys: [],
        limitations: []
      },
      matchSnapshot: savedMatch
    };
    const backup = sanitizeBackupFile({
      settings: settings(),
      matches: [savedMatch],
      deletedMatches: [],
      replays: [replay],
      deletedReplays: []
    } as unknown as RiftLiteBackupFile);

    expect(backup.matches[0]?.insightContext).toBeUndefined();
    expect(backup.matches[0]?.rawEvidence).toEqual([]);
    expect(backup.replays[0]?.enhancedInsights).toBeUndefined();
    expect(backup.replays[0]?.intelligence).toBeUndefined();
    expect(backup.replays[0]?.events).toEqual([]);
    expect(backup.replays[0]?.structuredEvents).toEqual([]);
    expect(backup.replays[0]?.flags?.map((flag) => flag.id)).toEqual(["ordinary-flag"]);
    expect(backup.replays[0]?.matchSnapshot?.insightContext).toBeUndefined();
    expect(backup.replays[0]?.matchSnapshot?.rawEvidence).toEqual([]);
    expect(backup.matches[0]?.notes).toBe("ordinary note");
    const serializedBackup = JSON.stringify(backup);
    expect(serializedBackup).not.toContain("Private source row");
    expect(serializedBackup).not.toContain("private decision note");
    expect(serializedBackup).not.toContain("private marker");
    expect(serializedBackup).not.toContain("private correction note");
    expect(serializedBackup).not.toContain("private derived story");
  });

  it("does not remove ordinary structured replay evidence from a replay not marked enhanced", () => {
    const savedMatch = match("match-2");
    delete savedMatch.insightContext;
    const replay = {
      id: "replay-2",
      matchId: savedMatch.id,
      platform: "atlas",
      capturedAt: savedMatch.capturedAt,
      schemaVersion: 5,
      title: "Replay",
      players: {},
      events: [...savedMatch.rawEvidence],
      structuredEvents: [{
        id: "ordinary-semantic",
        capturedAt: savedMatch.capturedAt,
        labelTime: "00:00",
        type: "match-start",
        side: "system",
        text: "Match started.",
        battlefield: ""
      }]
    } as ReplayRecord;
    const backup = sanitizeBackupFile({
      settings: settings(),
      matches: [savedMatch],
      deletedMatches: [],
      replays: [replay],
      deletedReplays: []
    } as unknown as RiftLiteBackupFile);

    expect(backup.replays[0]?.structuredEvents?.map((event) => event.id)).toEqual(["ordinary-semantic"]);
    expect(backup.replays[0]?.events.map((event) => event.id)).toEqual(["raw-match-2"]);
    expect(backup.matches[0]?.rawEvidence.map((event) => event.id)).toEqual(["raw-match-2"]);
  });

  it("fails closed when older enhanced replays only carry private context or marker flags", () => {
    const savedMatch = match("match-3");
    const contextOnlyReplay = {
      id: "replay-3",
      matchId: savedMatch.id,
      platform: "atlas",
      capturedAt: savedMatch.capturedAt,
      schemaVersion: 5,
      title: "Legacy enhanced replay",
      players: {},
      events: [],
      structuredEvents: [{
        id: "private-semantic",
        capturedAt: savedMatch.capturedAt,
        labelTime: "00:00",
        type: "action",
        side: "me",
        text: "Private enhanced evidence.",
        battlefield: ""
      }],
      flags: []
    } as ReplayRecord;
    const backup = sanitizeBackupFile({
      settings: settings(),
      matches: [savedMatch],
      deletedMatches: [],
      replays: [contextOnlyReplay],
      deletedReplays: []
    } as unknown as RiftLiteBackupFile);

    expect(backup.replays[0]?.structuredEvents).toEqual([]);
    expect(backup.replays[0]?.matchSnapshot?.insightContext).toBeUndefined();
  });

  it("clears persisted insight evidence, immutable payloads, and every automatic recovery candidate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-enhanced-insights-clear-"));
    const dbPath = join(directory, "riftlite-v06.sqlite");
    const legacyPath = join(directory, "riftlite-v06-store.json");
    try {
      const store = new RiftLiteStore(dbPath, legacyPath);
      await store.load();
      const savedMatch: MatchDraft = {
        ...match("persisted-match"),
        status: "pending-review",
        result: "Incomplete"
      };
      await store.saveMatch(savedMatch);
      const replay: ReplayRecord = {
        id: "persisted-replay",
        matchId: savedMatch.id,
        platform: "atlas",
        capturedAt: savedMatch.capturedAt,
        schemaVersion: 5,
        title: "Enhanced local replay",
        players: { me: "Player", opponent: "Opponent" },
        events: [...savedMatch.rawEvidence],
        structuredEvents: [{
          id: "private-combat",
          capturedAt: "2026-09-01T10:05:00.000Z",
          labelTime: "05:00",
          type: "combat",
          side: "me",
          text: "Private combat decision.",
          battlefield: ""
        }],
        flags: [{
          id: "enhanced-insight-private-combat",
          targetType: "replay",
          targetId: "persisted-replay",
          targetLabel: "Private combat",
          label: "Review decision",
          note: "private marker",
          capturedAt: "2026-09-01T10:05:00.000Z",
          createdAt: "2026-09-01T10:05:00.000Z"
        }, {
          id: "ordinary-rules-check",
          targetType: "replay",
          targetId: "persisted-replay",
          targetLabel: "Rules check",
          label: "Rules check",
          note: "ordinary note",
          capturedAt: "2026-09-01T10:06:00.000Z",
          createdAt: "2026-09-01T10:06:00.000Z"
        }],
        enhancedInsights: {
          version: 1,
          captured: true,
          capturedAt: savedMatch.capturedAt,
          captureMode: "semantic-local"
        },
        intelligence: {
          version: 1,
          generatedAt: savedMatch.capturedAt,
          sourceEventCount: 1,
          corrections: [{
            id: "private-correction",
            eventId: "private-combat",
            updatedAt: savedMatch.capturedAt,
            note: "private correction"
          }],
          coverage: {
            grade: "limited",
            totalEvents: 1,
            confirmed: 1,
            reconstructed: 0,
            inferred: 0,
            manual: 0,
            cardEvents: 0,
            scoreEvents: 0,
            turnEvents: 0,
            hasVideo: false
          },
          stats: {
            games: 1,
            turns: 0,
            cardActions: 0,
            draws: 0,
            plays: 0,
            moves: 0,
            scoringEvents: 0,
            combats: 1,
            battlefieldChanges: 0,
            mulligans: 0
          },
          story: ["private story"],
          moments: [{
            id: "private-moment",
            kind: "decision",
            title: "Private moment",
            body: "private moment detail",
            confidence: "manual"
          }],
          cardJourneys: [],
          limitations: []
        },
        matchSnapshot: savedMatch
      };
      await store.saveReplay(replay);

      const beforeMatch = (await store.getMatches()).find((candidate) => candidate.id === savedMatch.id);
      const beforeReplay = (await store.getReplays()).find((candidate) => candidate.id === replay.id);
      expect(beforeMatch?.rawEvidence).toHaveLength(1);
      expect(beforeReplay?.matchSnapshot?.rawEvidence).toHaveLength(1);
      expect(beforeReplay?.intelligence?.corrections[0]?.note).toBe("private correction");
      expect(beforeReplay?.intelligence?.moments).not.toHaveLength(0);

      const payloadDirectory = join(directory, "replay-payloads");
      const oldPayloads = await readdir(payloadDirectory);
      expect(oldPayloads).toHaveLength(1);
      const orphanPayload = `${"a".repeat(20)}-${"b".repeat(64)}.json.gz`;
      await writeFile(join(payloadDirectory, orphanPayload), "orphaned private payload", "utf8");
      const crashUuid = "12345678-1234-4abc-8def-1234567890ab";
      const payloadTemp = `.${oldPayloads[0]}.999.12345678-1234-4abc-8def-1234567890ab.tmp`;
      const payloadTempLookalike = `${payloadTemp}.keep`;
      const payloadInvalidUuidLookalike = `.${oldPayloads[0]}.999.12345678-1234-3abc-8def-1234567890ab.tmp`;
      await writeFile(join(payloadDirectory, payloadTemp), "crashed private payload", "utf8");
      await writeFile(join(payloadDirectory, payloadTempLookalike), "must remain", "utf8");
      await writeFile(join(payloadDirectory, payloadInvalidUuidLookalike), "must remain", "utf8");

      const databaseTemp = `riftlite-v06.sqlite.tmp-999-123-${crashUuid}`;
      const databaseTempLookalike = `${databaseTemp}.keep`;
      const databaseInvalidUuidLookalike = "riftlite-v06.sqlite.tmp-999-123-12345678-1234-3abc-8def-1234567890ab";
      await writeFile(join(directory, databaseTemp), "crashed private database", "utf8");
      await writeFile(join(directory, databaseTempLookalike), "must remain", "utf8");
      await writeFile(join(directory, databaseInvalidUuidLookalike), "must remain", "utf8");

      const backupDirectory = join(directory, "database-backups");
      await mkdir(backupDirectory, { recursive: true });
      const nestedRecoveryCandidate = "riftlite-v06-auto-before-clear-100.sqlite";
      const rootRecoveryCandidate = "riftlite-v06-repair-backup-100.sqlite";
      await copyFile(dbPath, join(backupDirectory, nestedRecoveryCandidate));
      await copyFile(dbPath, join(directory, rootRecoveryCandidate));

      await expect(store.clearEnhancedInsightsData()).resolves.toEqual({
        matchesUpdated: 1,
        replaysUpdated: 1
      });

      const clearedMatch = (await store.getMatches()).find((candidate) => candidate.id === savedMatch.id);
      const clearedReplay = (await store.getReplays()).find((candidate) => candidate.id === replay.id);
      expect(clearedMatch?.insightContext).toBeUndefined();
      expect(clearedMatch?.rawEvidence).toEqual([]);
      expect(clearedReplay?.enhancedInsights).toBeUndefined();
      expect(clearedReplay?.events).toEqual([]);
      expect(clearedReplay?.structuredEvents).toEqual([]);
      expect(clearedReplay?.matchSnapshot?.insightContext).toBeUndefined();
      expect(clearedReplay?.matchSnapshot?.rawEvidence).toEqual([]);
      expect(clearedReplay?.flags?.map((flag) => flag.id)).toEqual(["ordinary-rules-check"]);
      expect(clearedReplay?.intelligence?.corrections).toEqual([]);
      expect(clearedReplay?.intelligence?.moments).toEqual([]);
      expect(JSON.stringify(clearedReplay)).not.toContain("private correction");
      expect(JSON.stringify(clearedReplay)).not.toContain("Private moment");

      const remainingPayloads = await readdir(payloadDirectory);
      expect(remainingPayloads.filter((name) => /^[a-f0-9]{20}-[a-f0-9]{64}\.json\.gz$/.test(name))).toHaveLength(1);
      expect(remainingPayloads).not.toContain(oldPayloads[0]);
      expect(remainingPayloads).not.toContain(orphanPayload);
      expect(remainingPayloads).not.toContain(payloadTemp);
      expect(remainingPayloads).toContain(payloadTempLookalike);
      expect(remainingPayloads).toContain(payloadInvalidUuidLookalike);
      const remainingNestedBackups = await readdir(backupDirectory);
      expect(remainingNestedBackups).toHaveLength(1);
      expect(remainingNestedBackups[0]).toMatch(/^riftlite-v06-auto-post-insights-clear-\d+\.sqlite$/);
      const remainingRootFiles = await readdir(directory);
      expect(remainingRootFiles).not.toContain(rootRecoveryCandidate);
      expect(remainingRootFiles).not.toContain(databaseTemp);
      expect(remainingRootFiles).toContain(databaseTempLookalike);
      expect(remainingRootFiles).toContain(databaseInvalidUuidLookalike);

      const restarted = new RiftLiteStore(dbPath, legacyPath);
      await restarted.load();
      const restartedReplay = (await restarted.getReplays()).find((candidate) => candidate.id === replay.id);
      expect(restartedReplay?.intelligence?.corrections).toEqual([]);
      expect(restartedReplay?.intelligence?.moments).toEqual([]);
      expect(restartedReplay?.matchSnapshot?.rawEvidence).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("durably rejects stale Enhanced Insights whole-record saves after a clear", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-enhanced-insights-tombstone-"));
    const dbPath = join(directory, "riftlite-v06.sqlite");
    const legacyPath = join(directory, "riftlite-v06-store.json");
    try {
      const store = new RiftLiteStore(dbPath, legacyPath);
      await store.load();
      const staleMatch: MatchDraft = {
        ...match("stale-match"),
        capturedAt: "2020-01-01T10:00:00.000Z",
        updatedAt: "2020-01-01T10:20:00.000Z",
        status: "pending-review",
        result: "Incomplete"
      };
      staleMatch.rawEvidence = staleMatch.rawEvidence.map((event) => ({
        ...event,
        capturedAt: "2020-01-01T10:05:00.000Z"
      }));
      staleMatch.insightContext = {
        ...staleMatch.insightContext!,
        decisions: staleMatch.insightContext!.decisions.map((decision) => ({
          ...decision,
          capturedAt: "2020-01-01T10:05:00.000Z",
          createdAt: "2020-01-01T10:05:00.000Z"
        })),
        updatedAt: "2020-01-01T10:20:00.000Z"
      };
      const staleReplay: ReplayRecord = {
        id: "stale-replay",
        matchId: staleMatch.id,
        platform: "atlas",
        capturedAt: staleMatch.capturedAt,
        schemaVersion: 5,
        title: "Stale replay",
        players: { me: "Player", opponent: "Opponent" },
        events: [...staleMatch.rawEvidence],
        structuredEvents: [{
          id: "stale-private-event",
          capturedAt: "2020-01-01T10:05:00.000Z",
          labelTime: "05:00",
          type: "action",
          side: "me",
          text: "Stale private evidence",
          battlefield: ""
        }],
        flags: [{
          id: "enhanced-insight-stale-private-event",
          targetType: "replay",
          targetId: "stale-replay",
          targetLabel: "Private decision",
          label: "Review decision",
          note: "stale private marker",
          capturedAt: "2020-01-01T10:05:00.000Z",
          createdAt: "2020-01-01T10:05:00.000Z"
        }, {
          id: "ordinary-marker",
          targetType: "replay",
          targetId: "stale-replay",
          targetLabel: "Ordinary marker",
          label: "Rules check",
          note: "ordinary note",
          capturedAt: "2020-01-01T10:06:00.000Z",
          createdAt: "2020-01-01T10:06:00.000Z"
        }],
        enhancedInsights: {
          version: 1,
          captured: true,
          capturedAt: staleMatch.capturedAt,
          captureMode: "semantic-local"
        },
        matchSnapshot: staleMatch
      };

      await store.saveMatch(staleMatch);
      await store.saveReplay(staleReplay);
      await store.clearEnhancedInsightsData();

      const rendererReattachedMatch: MatchDraft = {
        ...staleMatch,
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
        insightContext: {
          ...staleMatch.insightContext!,
          updatedAt: new Date(Date.now() + 60_000).toISOString()
        }
      };
      const deferredMatch = await store.deferMatchReview(rendererReattachedMatch);
      const resavedMatch = await store.saveMatch(rendererReattachedMatch);
      const resavedReplay = await store.saveReplay({ ...staleReplay, title: "Stale replay edit" });
      expect(deferredMatch.insightContext).toBeUndefined();
      expect(deferredMatch.rawEvidence).toEqual([]);
      expect(resavedMatch.insightContext).toBeUndefined();
      expect(resavedMatch.rawEvidence).toEqual([]);
      expect(resavedReplay.enhancedInsights).toBeUndefined();
      expect(resavedReplay.events).toEqual([]);
      expect(resavedReplay.structuredEvents).toEqual([]);
      expect(resavedReplay.matchSnapshot?.insightContext).toBeUndefined();
      expect(resavedReplay.matchSnapshot?.rawEvidence).toEqual([]);
      expect(resavedReplay.flags?.map((flag) => flag.id)).toEqual(["ordinary-marker"]);

      const restarted = new RiftLiteStore(dbPath, legacyPath);
      await restarted.load();
      const restartedMatch = await restarted.saveMatch(rendererReattachedMatch);
      const restartedReplay = await restarted.saveReplay({ ...staleReplay, title: "Second stale replay edit" });
      expect(restartedMatch.insightContext).toBeUndefined();
      expect(restartedMatch.rawEvidence).toEqual([]);
      expect(restartedReplay.enhancedInsights).toBeUndefined();
      expect(restartedReplay.structuredEvents).toEqual([]);

      const postClearCapturedAt = new Date(Date.now() + 60_000).toISOString();
      const postClearMatch: MatchDraft = {
        ...match("post-clear-match"),
        capturedAt: postClearCapturedAt,
        updatedAt: postClearCapturedAt,
        status: "pending-review",
        result: "Incomplete",
        rawEvidence: match("post-clear-match").rawEvidence.map((event) => ({
          ...event,
          capturedAt: postClearCapturedAt
        })),
        insightContext: {
          ...match("post-clear-match").insightContext!,
          decisions: match("post-clear-match").insightContext!.decisions.map((decision) => ({
            ...decision,
            capturedAt: postClearCapturedAt,
            createdAt: postClearCapturedAt
          })),
          updatedAt: postClearCapturedAt
        }
      };
      const savedPostClearMatch = await restarted.saveMatch(postClearMatch);
      expect(savedPostClearMatch.insightContext?.capturedWithEnhancedInsights).toBe(true);
      expect(savedPostClearMatch.rawEvidence).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
