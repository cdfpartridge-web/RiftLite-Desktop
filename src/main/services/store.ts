import { app } from "electron";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { deckNotebookWithCurrentVersion, deckSnapshotHash, emptyDeckNotebook, normalizeDeckNotebook, sanitizeDeckNotebookForDeck } from "../../shared/deckNotebook.js";
import { normalizeLegendName } from "../../shared/legendNames.js";
import type { CaptureEvent, DeckNotebook, ImportSummary, MatchDraft, OverlayDisplayOptions, ReplayRecord, SavedDeck, UserSettings } from "../../shared/types.js";

interface PersistedState {
  settings?: Partial<UserSettings>;
  matches?: MatchDraft[];
}

const require = createRequire(import.meta.url);

const DEFAULT_SETTINGS: UserSettings = {
  username: "",
  firstRunComplete: false,
  lastSeenVersion: "",
  syncMode: "community-and-hubs",
  communitySyncEnabled: true,
  firebaseUid: "",
  firebaseRefreshToken: "",
  accountUid: "",
  accountEmail: "",
  accountHandle: "",
  accountDisplayName: "",
  accountProfilePublic: false,
  anonymousDiagnosticsEnabled: true,
  anonymousInstallId: "",
  anonymousInstallCreatedAt: "",
  anonymousUsageLastHeartbeatAt: "",
  anonymousUsageLastHeartbeatVersion: "",
  debugMode: false,
  confirmationEnabled: true,
  replayCaptureEnabled: true,
  replayKeyframesEnabled: true,
  replayFramePreset: "standard",
  replayVideoEnabled: true,
  replayVideoMode: "game-frame",
  replayVideoQuality: "sharp",
  replayMicAudioEnabled: false,
  deckTrackerEnabled: false,
  deckTrackerAutoStart: false,
  deckTrackerSaveToReplay: false,
  deckTrackerPinnedCards: {},
  microphoneDeviceId: "",
  gameZoomFactor: 1,
  autoSaveAfterSeconds: 45,
  overlaySessionStartedAt: "",
  overlayDisplay: defaultOverlayDisplay(),
  screenshotDirectory: "",
  replayDirectory: "",
  screenshotHotkey: "F9",
  screenshotHotkeyEnabled: true,
  scorepadDeviceId: "",
  scorepadDeviceSecret: "",
  scorepadLinkedAt: "",
  activeDeckId: "",
  activeHubs: []
};

function normalizeReplayVideoMode(_value: unknown): UserSettings["replayVideoMode"] {
  return "game-frame";
}

function normalizeReplayFramePreset(value: unknown): UserSettings["replayFramePreset"] {
  return value === "light" || value === "detailed" ? value : "standard";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJsonToken<T>(token: string): T | undefined {
  try {
    return JSON.parse(token) as T;
  } catch {
    return undefined;
  }
}

function recoverSettingsFromCorruptJson(value: string): Partial<UserSettings> {
  const recovered: Record<string, unknown> = {};
  const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>;
  for (const key of keys) {
    if (key === "overlayDisplay" || key === "activeHubs") {
      continue;
    }
    const pattern = new RegExp(
      `"${escapeRegExp(String(key))}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|true|false|null|-?\\d+(?:\\.\\d+)?)`
    );
    const match = value.match(pattern);
    if (!match) {
      continue;
    }
    const parsed = parseJsonToken<unknown>(match[1]);
    if (parsed !== undefined) {
      recovered[key] = parsed;
    }
  }

  const activeHubsMatch = value.match(/"activeHubs"\s*:\s*(\[[^\]]*\])/);
  if (activeHubsMatch) {
    const parsed = parseJsonToken<unknown>(activeHubsMatch[1]);
    if (Array.isArray(parsed)) {
      recovered.activeHubs = parsed;
    }
  }

  const overlayMatch = value.match(/"overlayDisplay"\s*:\s*(\{[^{}]*\})/);
  if (overlayMatch) {
    const parsed = parseJsonToken<unknown>(overlayMatch[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      recovered.overlayDisplay = parsed;
    }
  }

  return recovered as Partial<UserSettings>;
}

export class RiftLiteStore {
  private readonly dbPath: string;
  private readonly legacyJsonPath: string;
  private sql: SqlJsStatic | null = null;
  private db: Database | null = null;
  private loadPromise: Promise<void> | null = null;
  private settingsCache: UserSettings | null = null;

  constructor(
    dbPath = join(app.getPath("userData"), "riftlite-v06.sqlite"),
    legacyJsonPath = join(app.getPath("userData"), "riftlite-v06-store.json")
  ) {
    this.dbPath = dbPath;
    this.legacyJsonPath = legacyJsonPath;
  }

  async load(): Promise<void> {
    if (this.db) {
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.open();
    }
    await this.loadPromise;
  }

  async getSettings(): Promise<UserSettings> {
    if (this.settingsCache) {
      return this.settingsCache;
    }
    const db = await this.database();
    const row = db.exec("SELECT value_json FROM settings WHERE key='settings'")[0]?.values[0]?.[0];
    let parsed: Partial<UserSettings> = {};
    let repairedCorruptSettings = false;
    if (typeof row === "string") {
      try {
        parsed = JSON.parse(row) as Partial<UserSettings>;
      } catch (error) {
        repairedCorruptSettings = true;
        parsed = recoverSettingsFromCorruptJson(row);
        console.warn("RiftLite settings JSON was corrupt and has been repaired", error);
        await this.backupCorruptSettings(row);
      }
    }
    this.settingsCache = this.normalizeSettings(parsed);
    if (repairedCorruptSettings) {
      db.run("INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)", [
        "settings",
        JSON.stringify(this.settingsCache),
        Date.now()
      ]);
      await this.persist();
    }
    return this.settingsCache;
  }

  private normalizeSettings(parsed: Partial<UserSettings>): UserSettings {
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      replayVideoMode: normalizeReplayVideoMode((parsed as { replayVideoMode?: unknown }).replayVideoMode),
      replayFramePreset: normalizeReplayFramePreset((parsed as { replayFramePreset?: unknown }).replayFramePreset),
      overlayDisplay: { ...DEFAULT_SETTINGS.overlayDisplay, ...parsed.overlayDisplay },
      deckTrackerPinnedCards: parsed.deckTrackerPinnedCards && typeof parsed.deckTrackerPinnedCards === "object" && !Array.isArray(parsed.deckTrackerPinnedCards)
        ? parsed.deckTrackerPinnedCards
        : {},
      activeHubs: Array.isArray(parsed.activeHubs) ? parsed.activeHubs : []
    };
  }

  private async backupCorruptSettings(value: string): Promise<void> {
    const backupPath = join(dirname(this.dbPath), `riftlite-settings-corrupt-${Date.now()}.json`);
    await writeFile(backupPath, value, "utf8").catch(() => undefined);
  }

  async saveSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.getSettings();
    const replayVideoMode = Object.prototype.hasOwnProperty.call(patch, "replayVideoMode")
      ? normalizeReplayVideoMode((patch as { replayVideoMode?: unknown }).replayVideoMode)
      : current.replayVideoMode;
    const replayFramePreset = Object.prototype.hasOwnProperty.call(patch, "replayFramePreset")
      ? normalizeReplayFramePreset((patch as { replayFramePreset?: unknown }).replayFramePreset)
      : current.replayFramePreset;
    const next: UserSettings = {
      ...current,
      ...patch,
      replayVideoMode,
      replayFramePreset,
      activeHubs: patch.activeHubs ? [...patch.activeHubs] : current.activeHubs
    };
    const db = await this.database();
    db.run("INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)", [
      "settings",
      JSON.stringify(next),
      Date.now()
    ]);
    this.settingsCache = next;
    await this.persist();
    return next;
  }

  async getMatches(): Promise<MatchDraft[]> {
    const db = await this.database();
    const result = db.exec("SELECT data_json FROM matches ORDER BY captured_at DESC");
    return (result[0]?.values ?? [])
      .map((row) => normalizeStoredMatch(JSON.parse(String(row[0])) as MatchDraft))
      .filter((match) => !match.deletedAt);
  }

  async getDeletedMatches(): Promise<MatchDraft[]> {
    const db = await this.database();
    const result = db.exec("SELECT data_json FROM matches ORDER BY updated_at DESC");
    return (result[0]?.values ?? [])
      .map((row) => normalizeStoredMatch(JSON.parse(String(row[0])) as MatchDraft))
      .filter((match) => Boolean(match.deletedAt));
  }

  async saveMatch(draft: MatchDraft): Promise<MatchDraft> {
    const db = await this.database();
    const now = new Date().toISOString();
    const next = compactMatchForStorage(normalizeStoredMatch({ ...draft, updatedAt: now }));
    await this.withDatabaseRepair("save-match", async () => {
      db.run(
        `INSERT OR REPLACE INTO matches
         (id, platform, status, result, captured_at, updated_at, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [next.id, next.platform, next.status, next.result, next.capturedAt, next.updatedAt, JSON.stringify(next)]
      );
      await this.persist();
    });
    return next;
  }

  async deleteMatch(id: string): Promise<void> {
    const db = await this.database();
    const row = db.exec("SELECT data_json FROM matches WHERE id=?", [id])[0]?.values[0]?.[0];
    if (typeof row === "string") {
      const now = new Date().toISOString();
      const match = normalizeStoredMatch({ ...JSON.parse(row) as MatchDraft, deletedAt: now, updatedAt: now });
      db.run("UPDATE matches SET updated_at=?, data_json=? WHERE id=?", [match.updatedAt, JSON.stringify(match), id]);
      await this.deleteReplayByMatch(id, now);
    }
    await this.persist();
  }

  async restoreMatch(id: string): Promise<MatchDraft | null> {
    const db = await this.database();
    const row = db.exec("SELECT data_json FROM matches WHERE id=?", [id])[0]?.values[0]?.[0];
    if (typeof row !== "string") {
      return null;
    }
    const now = new Date().toISOString();
    const match = normalizeStoredMatch({ ...JSON.parse(row) as MatchDraft, deletedAt: undefined, updatedAt: now });
    delete match.deletedAt;
    db.run("UPDATE matches SET updated_at=?, data_json=? WHERE id=?", [match.updatedAt, JSON.stringify(match), id]);
    await this.restoreReplayByMatch(id);
    await this.persist();
    return match;
  }

  async purgeMatch(id: string): Promise<void> {
    const db = await this.database();
    db.run("DELETE FROM matches WHERE id=?", [id]);
    db.run("DELETE FROM replays WHERE match_id=?", [id]);
    await this.persist();
  }

  async getSavedDecks(): Promise<SavedDeck[]> {
    const db = await this.database();
    const result = db.exec(
      `SELECT id, source_url, source_key, title, legend, snapshot_json,
              last_imported_at, last_refresh_status, last_refresh_error
       FROM saved_decks
       ORDER BY title COLLATE NOCASE ASC, last_imported_at DESC`
    );
    return (result[0]?.values ?? []).map(savedDeckFromRow);
  }

  async getSavedDeck(id: string): Promise<SavedDeck | null> {
    const db = await this.database();
    const result = db.exec(
      `SELECT id, source_url, source_key, title, legend, snapshot_json,
              last_imported_at, last_refresh_status, last_refresh_error
       FROM saved_decks
       WHERE id=?`,
      [id]
    );
    const row = result[0]?.values[0];
    return row ? savedDeckFromRow(row) : null;
  }

  async getSavedDeckBySourceKey(sourceKey: string): Promise<SavedDeck | null> {
    const key = sourceKey.trim();
    if (!key) {
      return null;
    }
    const db = await this.database();
    const result = db.exec(
      `SELECT id, source_url, source_key, title, legend, snapshot_json,
              last_imported_at, last_refresh_status, last_refresh_error
       FROM saved_decks
       WHERE source_key=?`,
      [key]
    );
    const row = result[0]?.values[0];
    return row ? savedDeckFromRow(row) : null;
  }

  async upsertSavedDeck(deck: Partial<SavedDeck> & Pick<SavedDeck, "title" | "legend" | "snapshotJson">): Promise<SavedDeck> {
    const db = await this.database();
    const now = new Date().toISOString();
    const existing = deck.sourceKey ? await this.getSavedDeckBySourceKey(deck.sourceKey) : deck.id ? await this.getSavedDeck(deck.id) : null;
    const next: SavedDeck = {
      id: existing?.id || deck.id || randomUUID(),
      sourceUrl: deck.sourceUrl ?? existing?.sourceUrl ?? "",
      sourceKey: deck.sourceKey ?? existing?.sourceKey ?? "",
      title: deck.title.trim() || existing?.title || "Untitled deck",
      legend: normalizeLegendName(deck.legend || existing?.legend || ""),
      snapshotJson: deck.snapshotJson || existing?.snapshotJson || "",
      lastImportedAt: now,
      lastRefreshStatus: deck.lastRefreshStatus ?? "ok",
      lastRefreshError: deck.lastRefreshError ?? ""
    };
    db.run(
      `INSERT OR REPLACE INTO saved_decks
       (id, source_url, source_key, title, legend, snapshot_json, last_imported_at, last_refresh_status, last_refresh_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        next.id,
        next.sourceUrl,
        next.sourceKey,
        next.title,
        next.legend,
        next.snapshotJson,
        next.lastImportedAt,
        next.lastRefreshStatus,
        next.lastRefreshError
      ]
    );
    this.ensureDeckNotebookCurrentVersion(db, next);
    await this.persist();
    return next;
  }

  async renameSavedDeck(id: string, title: string): Promise<SavedDeck> {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      throw new Error("Deck name is required.");
    }
    const db = await this.database();
    const existing = await this.getSavedDeck(id);
    if (!existing) {
      throw new Error("Deck not found.");
    }
    const next: SavedDeck = { ...existing, title: cleanTitle };
    db.run("UPDATE saved_decks SET title=? WHERE id=?", [next.title, next.id]);

    const notebook = this.readDeckNotebook(db, next.id);
    const currentHash = deckSnapshotHash(next.snapshotJson);
    if (currentHash && notebook.versions.some((version) => version.snapshotHash === currentHash && version.title !== cleanTitle)) {
      this.writeDeckNotebook(db, next.id, {
        ...notebook,
        versions: notebook.versions.map((version) => (
          version.snapshotHash === currentHash ? { ...version, title: cleanTitle } : version
        )),
        updatedAt: new Date().toISOString()
      });
    }

    await this.persist();
    return next;
  }

  async deleteSavedDeck(id: string): Promise<void> {
    const db = await this.database();
    db.run("DELETE FROM saved_decks WHERE id=?", [id]);
    db.run("DELETE FROM deck_notebooks WHERE deck_id=?", [id]);
    const settings = await this.getSettings();
    if (settings.activeDeckId === id) {
      await this.saveSettings({ activeDeckId: "" });
      return;
    }
    await this.persist();
  }

  async getDeckNotebook(deckId: string): Promise<DeckNotebook> {
    const db = await this.database();
    const deck = await this.getSavedDeck(deckId);
    const notebook = this.readDeckNotebook(db, deckId);
    if (!deck) {
      return notebook;
    }
    const next = deckNotebookWithCurrentVersion(notebook, deck);
    if (JSON.stringify(next) !== JSON.stringify(notebook)) {
      this.writeDeckNotebook(db, deckId, next);
      await this.persist();
    }
    return next;
  }

  async saveDeckNotebook(deckId: string, notebook: DeckNotebook): Promise<DeckNotebook> {
    const db = await this.database();
    const deck = await this.getSavedDeck(deckId);
    let next = normalizeDeckNotebook(deckId, notebook);
    if (deck) {
      next = sanitizeDeckNotebookForDeck(deckNotebookWithCurrentVersion(next, deck), deck);
    }
    next = { ...next, updatedAt: new Date().toISOString() };
    this.writeDeckNotebook(db, deckId, next);
    await this.persist();
    return next;
  }

  async getReplays(): Promise<ReplayRecord[]> {
    const db = await this.database();
    const result = db.exec("SELECT data_json FROM replays ORDER BY captured_at DESC");
    return (result[0]?.values ?? [])
      .map((row) => JSON.parse(String(row[0])) as ReplayRecord)
      .filter((replay) => !replay.deletedAt);
  }

  async getDeletedReplays(): Promise<ReplayRecord[]> {
    const db = await this.database();
    const result = db.exec("SELECT data_json FROM replays ORDER BY captured_at DESC");
    return (result[0]?.values ?? [])
      .map((row) => JSON.parse(String(row[0])) as ReplayRecord)
      .filter((replay) => Boolean(replay.deletedAt));
  }

  async saveReplay(replay: ReplayRecord): Promise<ReplayRecord> {
    const db = await this.database();
    const next = compactReplayForStorage(replay);
    await this.withDatabaseRepair("save-replay", async () => {
      db.run(
        `INSERT OR REPLACE INTO replays
         (id, match_id, platform, captured_at, data_json)
         VALUES (?, ?, ?, ?, ?)`,
        [next.id, next.matchId, next.platform, next.capturedAt, JSON.stringify(next)]
      );
      await this.persist();
    });
    return next;
  }

  async deleteReplay(id: string): Promise<void> {
    const db = await this.database();
    const now = new Date().toISOString();
    const row = db.exec("SELECT data_json FROM replays WHERE id=?", [id])[0]?.values[0]?.[0];
    if (typeof row === "string") {
      const replay = { ...JSON.parse(row) as ReplayRecord, deletedAt: now };
      db.run("UPDATE replays SET data_json=? WHERE id=?", [JSON.stringify(replay), id]);
      await this.persist();
    }
  }

  async restoreReplay(id: string): Promise<ReplayRecord | null> {
    const db = await this.database();
    const row = db.exec("SELECT data_json FROM replays WHERE id=?", [id])[0]?.values[0]?.[0];
    if (typeof row !== "string") {
      return null;
    }
    const replay = { ...JSON.parse(row) as ReplayRecord, deletedAt: undefined };
    delete replay.deletedAt;
    db.run("UPDATE replays SET data_json=? WHERE id=?", [JSON.stringify(replay), id]);
    await this.persist();
    return replay;
  }

  async purgeReplay(id: string): Promise<void> {
    const db = await this.database();
    db.run("DELETE FROM replays WHERE id=?", [id]);
    await this.persist();
  }

  async deleteReplayByMatch(matchId: string, deletedAt = new Date().toISOString()): Promise<void> {
    const db = await this.database();
    const result = db.exec("SELECT id, data_json FROM replays WHERE match_id=?", [matchId]);
    for (const row of result[0]?.values ?? []) {
      const replay = { ...JSON.parse(String(row[1])) as ReplayRecord, deletedAt };
      db.run("UPDATE replays SET data_json=? WHERE id=?", [JSON.stringify(replay), String(row[0])]);
    }
    await this.persist();
  }

  async restoreReplayByMatch(matchId: string): Promise<void> {
    const db = await this.database();
    const result = db.exec("SELECT id, data_json FROM replays WHERE match_id=?", [matchId]);
    for (const row of result[0]?.values ?? []) {
      const replay = { ...JSON.parse(String(row[1])) as ReplayRecord, deletedAt: undefined };
      delete replay.deletedAt;
      db.run("UPDATE replays SET data_json=? WHERE id=?", [JSON.stringify(replay), String(row[0])]);
    }
    await this.persist();
  }

  async importLegacyData(sourcePath = join(homedir(), ".riftlite", "riftlite.db")): Promise<ImportSummary> {
    const db = await this.database();
    const summary: ImportSummary = { importedMatches: 0, importedHubs: 0, importedSettings: 0, sourcePath };
    if (!this.sql || !existsSync(sourcePath)) {
      return summary;
    }

    const legacy = new this.sql.Database(await readFile(sourcePath));
    try {
      const settings = readLegacySettings(legacy);
      const current = await this.getSettings();
      const joinedHubs = parseLegacyHubs(settings.joined_hubs);
      const nextSettings: Partial<UserSettings> = {
        username: settings.username || current.username,
        firebaseUid: settings.firebase_uid || current.firebaseUid,
        firebaseRefreshToken: settings.firebase_refresh_token || current.firebaseRefreshToken,
        communitySyncEnabled: settings.auto_sync_enabled === "1" || current.communitySyncEnabled,
        firstRunComplete: current.firstRunComplete || Boolean(settings.username),
        activeHubs: mergeHubs(current.activeHubs, joinedHubs)
      };
      await this.saveSettings(nextSettings);
      summary.importedSettings = Object.keys(settings).length;
      summary.importedHubs = joinedHubs.length;

      const rows = legacy.exec("SELECT * FROM matches ORDER BY id ASC")[0];
      const columns = rows?.columns ?? [];
      for (const values of rows?.values ?? []) {
        const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
        const match = legacyRowToMatch(row, await this.getSettings());
        const exists = db.exec("SELECT id FROM matches WHERE id=?", [match.id])[0]?.values.length;
        const normalizedMatch = normalizeImportedMatch(match);
        db.run(
          `INSERT OR IGNORE INTO matches
           (id, platform, status, result, captured_at, updated_at, data_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            normalizedMatch.id,
            normalizedMatch.platform,
            normalizedMatch.status,
            normalizedMatch.result,
            normalizedMatch.capturedAt,
            normalizedMatch.updatedAt,
            JSON.stringify(normalizedMatch)
          ]
        );
        if (!exists) summary.importedMatches += 1;
      }
      await this.persist();
      return summary;
    } finally {
      legacy.close();
    }
  }

  private async open(): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    this.sql = await initSqlJs({ locateFile: () => wasmPath });
    const bytes = existsSync(this.dbPath) ? await readFile(this.dbPath) : null;
    this.db = bytes?.length ? new this.sql.Database(bytes) : new this.sql.Database();
    await this.repairDatabaseIfNeeded("startup-integrity-check");
    this.migrateSchema();
    await this.migrateLegacyJson();
    await this.importLegacyData().catch(() => undefined);
    this.compactStoredPayloads();
    await this.repairDatabaseIfNeeded("post-migration-integrity-check");
    await this.persist();
  }

  private async database(): Promise<Database> {
    await this.load();
    if (!this.db) {
      throw new Error("RiftLite database did not initialize");
    }
    return this.db;
  }

  private migrateSchema(): void {
    const db = this.db;
    if (!db) return;
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_matches_captured_at ON matches(captured_at DESC);
      CREATE TABLE IF NOT EXISTS replays (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_replays_match_id ON replays(match_id);
      CREATE TABLE IF NOT EXISTS saved_decks (
        id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        source_key TEXT NOT NULL,
        title TEXT NOT NULL,
        legend TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        last_imported_at TEXT NOT NULL,
        last_refresh_status TEXT NOT NULL,
        last_refresh_error TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_decks_source_key ON saved_decks(source_key) WHERE source_key <> '';
      CREATE TABLE IF NOT EXISTS deck_notebooks (
        deck_id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const existing = db.exec("SELECT value_json FROM settings WHERE key='settings'")[0]?.values[0]?.[0];
    if (!existing) {
      db.run("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)", [
        "settings",
        JSON.stringify(DEFAULT_SETTINGS),
        Date.now()
      ]);
    }
  }

  private async migrateLegacyJson(): Promise<void> {
    const db = this.db;
    if (!db || !existsSync(this.legacyJsonPath) || existsSync(`${this.legacyJsonPath}.migrated`)) {
      return;
    }
    try {
      const raw = await readFile(this.legacyJsonPath, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.settings) {
        const migratedSettings = { ...DEFAULT_SETTINGS, ...parsed.settings };
        db.run("INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)", [
          "settings",
          JSON.stringify(migratedSettings),
          Date.now()
        ]);
        this.settingsCache = {
          ...migratedSettings,
          overlayDisplay: { ...DEFAULT_SETTINGS.overlayDisplay, ...migratedSettings.overlayDisplay },
          activeHubs: Array.isArray(migratedSettings.activeHubs) ? migratedSettings.activeHubs : []
        };
      }
      for (const match of parsed.matches ?? []) {
        db.run(
          `INSERT OR IGNORE INTO matches
           (id, platform, status, result, captured_at, updated_at, data_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [match.id, match.platform, match.status, match.result, match.capturedAt, match.updatedAt, JSON.stringify(match)]
        );
      }
      await rename(this.legacyJsonPath, `${this.legacyJsonPath}.migrated`);
    } catch {
      return;
    }
  }

  private compactStoredPayloads(): void {
    const db = this.db;
    if (!db) return;
    let changed = false;
    for (const row of db.exec("SELECT id, data_json FROM matches")[0]?.values ?? []) {
      const id = String(row[0]);
      const raw = String(row[1] ?? "");
      try {
        const match = compactMatchForStorage(normalizeStoredMatch(JSON.parse(raw) as MatchDraft));
        const next = JSON.stringify(match);
        if (next !== raw) {
          db.run("UPDATE matches SET data_json=? WHERE id=?", [next, id]);
          changed = true;
        }
      } catch {
        continue;
      }
    }
    for (const row of db.exec("SELECT id, data_json FROM replays")[0]?.values ?? []) {
      const id = String(row[0]);
      const raw = String(row[1] ?? "");
      try {
        const replay = compactReplayForStorage(JSON.parse(raw) as ReplayRecord);
        const next = JSON.stringify(replay);
        if (next !== raw) {
          db.run("UPDATE replays SET data_json=? WHERE id=?", [next, id]);
          changed = true;
        }
      } catch {
        continue;
      }
    }
    const freePages = Number(db.exec("PRAGMA freelist_count")[0]?.values?.[0]?.[0] ?? 0);
    if (changed || freePages > 100) {
      db.run("VACUUM");
    }
  }

  private readDeckNotebook(db: Database, deckId: string): DeckNotebook {
    const raw = db.exec("SELECT data_json FROM deck_notebooks WHERE deck_id=?", [deckId])[0]?.values[0]?.[0];
    if (typeof raw !== "string") {
      return emptyDeckNotebook(deckId);
    }
    try {
      return normalizeDeckNotebook(deckId, JSON.parse(raw) as DeckNotebook);
    } catch {
      return emptyDeckNotebook(deckId);
    }
  }

  private writeDeckNotebook(db: Database, deckId: string, notebook: DeckNotebook): void {
    const next = normalizeDeckNotebook(deckId, notebook);
    const updatedAt = next.updatedAt || new Date().toISOString();
    db.run(
      "INSERT OR REPLACE INTO deck_notebooks (deck_id, data_json, updated_at) VALUES (?, ?, ?)",
      [deckId, JSON.stringify({ ...next, updatedAt }), updatedAt]
    );
  }

  private ensureDeckNotebookCurrentVersion(db: Database, deck: SavedDeck): void {
    const current = this.readDeckNotebook(db, deck.id);
    const next = deckNotebookWithCurrentVersion(current, deck);
    if (JSON.stringify(current) !== JSON.stringify(next)) {
      this.writeDeckNotebook(db, deck.id, next);
    }
  }

  private async persist(): Promise<void> {
    if (!this.db) {
      return;
    }
    await mkdir(dirname(this.dbPath), { recursive: true });
    await writeFile(this.dbPath, Buffer.from(this.db.export()));
  }

  private async withDatabaseRepair<T>(context: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!isDatabaseMalformedError(error)) {
        throw error;
      }
      await this.repairDatabase(context);
      return action();
    }
  }

  private async repairDatabaseIfNeeded(context: string): Promise<void> {
    const issue = this.databaseIntegrityIssue();
    if (issue) {
      await this.repairDatabase(context, issue);
    }
  }

  private databaseIntegrityIssue(): string {
    if (!this.db) {
      return "";
    }
    try {
      const value = String(this.db.exec("PRAGMA integrity_check")[0]?.values?.[0]?.[0] ?? "");
      return value && value.toLowerCase() !== "ok" ? value : "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private async repairDatabase(context: string, knownIssue = ""): Promise<void> {
    if (!this.db) {
      return;
    }
    await this.backupDatabase(context);
    this.db.run("VACUUM");
    const issue = this.databaseIntegrityIssue();
    if (issue) {
      throw new Error(`RiftLite database repair failed: ${knownIssue || issue}`);
    }
    await mkdir(dirname(this.dbPath), { recursive: true });
    await writeFile(this.dbPath, Buffer.from(this.db.export()));
  }

  private async backupDatabase(context: string): Promise<void> {
    if (!existsSync(this.dbPath)) {
      return;
    }
    const safeContext = context.replace(/[^a-z0-9-]+/gi, "-").slice(0, 40) || "repair";
    const backupPath = join(dirname(this.dbPath), `riftlite-v06-${safeContext}-backup-${Date.now()}.sqlite`);
    await copyFile(this.dbPath, backupPath).catch(() => undefined);
  }
}

function defaultOverlayDisplay(): OverlayDisplayOptions {
  return {
    profile: "grind",
    showBranding: true,
    showWebsite: true,
    showSession: true,
    showLatestMatch: true,
    showResult: true,
    showOpponentName: true,
    showScore: true,
    showPlatform: true,
    showDeck: true,
    showLegendWinRate: true,
    showMatchupWinRate: true,
    showActiveDeckStats: false,
    showDeckSessionStats: true,
    showDeckMatchups: true,
    showFooter: true
  };
}

function readLegacySettings(db: Database): Record<string, string> {
  const result = db.exec("SELECT key, value FROM settings")[0];
  return Object.fromEntries((result?.values ?? []).map((row) => [String(row[0]), String(row[1] ?? "")]));
}

function parseLegacyHubs(raw: string | undefined): UserSettings["activeHubs"] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return parsed.map((hub) => ({
      id: String(hub.id ?? ""),
      name: String(hub.name ?? hub.id ?? ""),
      sync: hub.sync !== false,
      role: "member" as const,
      joinedAt: new Date().toISOString()
    })).filter((hub) => hub.id && hub.name);
  } catch {
    return [];
  }
}

function mergeHubs(current: UserSettings["activeHubs"], imported: UserSettings["activeHubs"]): UserSettings["activeHubs"] {
  const byId = new Map<string, UserSettings["activeHubs"][number]>();
  for (const hub of [...imported, ...current]) {
    byId.set(hub.id, { ...byId.get(hub.id), ...hub });
  }
  return [...byId.values()];
}

function legacyRowToMatch(row: Record<string, unknown>, settings: UserSettings): MatchDraft {
  const id = `legacy-${readString(row.id)}`;
  const capturedAt = normalizeLegacyDate(readString(row.date));
  const games = parseGames(readString(row.games_json), row);
  const syncCommunity = readString(row.synced) === "1" ? "synced" : settings.communitySyncEnabled ? "pending" : "disabled";
  return {
    id,
    platform: "tcga",
    status: "saved",
    capturedAt,
    updatedAt: capturedAt,
    result: readResult(row.result),
    format: readFormat(row.format),
    score: readString(row.score),
    myName: settings.username,
    opponentName: readString(row.opp_name),
    myChampion: normalizeLegendName(row.my_champion),
    opponentChampion: normalizeLegendName(row.opp_champion),
    myBattlefield: readString(row.my_battlefield),
    opponentBattlefield: readString(row.opp_battlefield),
    deckName: readString(row.deck_name),
    deckSourceId: readString(row.deck_source_key) || readString(row.deck_id),
    deckSourceUrl: readString(row.deck_source_url),
    deckSourceKey: readString(row.deck_source_key),
    deckSnapshotJson: readString(row.deck_snapshot_json),
    flags: readString(row.flags),
    notes: readString(row.notes),
    games,
    rawEvidence: [],
    sync: {
      community: syncCommunity,
      hubs: Object.fromEntries(settings.activeHubs.filter((hub) => hub.sync).map((hub) => [hub.id, "pending"]))
    }
  };
}

function normalizeImportedMatch(match: MatchDraft): MatchDraft {
  return normalizeStoredMatch(match);
}

function normalizeStoredMatch(match: MatchDraft): MatchDraft {
  const deckSourceKey = match.deckSourceKey || match.deckSourceId || "";
  return {
    ...match,
    source: match.source ?? "capture",
    myChampion: normalizeLegendName(match.myChampion),
    opponentChampion: normalizeLegendName(match.opponentChampion),
    deckSourceId: deckSourceKey,
    deckSourceKey,
    deckSourceUrl: match.deckSourceUrl ?? "",
    deckSnapshotJson: match.deckSnapshotJson ?? ""
  };
}

function compactMatchForStorage(match: MatchDraft): MatchDraft {
  const shouldKeepEvidence = match.status !== "saved" || match.result === "Incomplete";
  return {
    ...match,
    rawEvidence: shouldKeepEvidence ? compactCaptureEvents(match.rawEvidence, 60) : []
  };
}

function compactReplayForStorage(replay: ReplayRecord): ReplayRecord {
  return {
    ...replay,
    events: compactCaptureEvents(replay.events ?? [], 24),
    structuredEvents: replay.structuredEvents?.slice(-300),
    visualFrames: replay.visualFrames ?? [],
    video: compactReplayVideoAsset(replay.video),
    matchSnapshot: replay.matchSnapshot ? compactMatchForStorage(replay.matchSnapshot) : undefined
  };
}

function compactReplayVideoAsset(video: ReplayRecord["video"]): ReplayRecord["video"] {
  if (!video) {
    return undefined;
  }
  const clean: Record<string, unknown> = { ...video };
  delete clean.data;
  delete clean.asset;
  delete clean.sourcePath;
  delete clean.sourceUrl;
  return clean as unknown as ReplayRecord["video"];
}

function compactCaptureEvents(events: CaptureEvent[], limit: number): CaptureEvent[] {
  return [...events]
    .slice(-limit)
    .map((event) => ({
      ...event,
      payload: compactCapturePayload(event.payload)
    }));
}

function compactCapturePayload(payload: Record<string, unknown> = {}): Record<string, unknown> {
  const keys = [
    "reason",
    "active",
    "format",
    "atlasResultKind",
    "endText",
    "configuredUsername",
    "localPlayerName",
    "myName",
    "opponentName",
    "myChampion",
    "opponentChampion",
    "myChampionImage",
    "opponentChampionImage",
    "myBattlefield",
    "opponentBattlefield",
    "myBattlefieldImage",
    "opponentBattlefieldImage",
    "roomCode",
    "phase",
    "turnText",
    "wentFirst",
    "deckName",
    "deckSourceId",
    "score",
    "scoreSource"
  ];
  const compact: Record<string, unknown> = {};
  for (const key of keys) {
    if (payload[key] !== undefined) {
      compact[key] = compactUnknown(payload[key]);
    }
  }
  compact.payloadKeys = Object.keys(payload).sort();
  if (Array.isArray(payload.counterPlayers)) {
    compact.counterPlayers = payload.counterPlayers.slice(0, 4).map(compactUnknown);
  }
  if (Array.isArray(payload.battlefieldCandidates)) {
    compact.battlefieldCandidates = payload.battlefieldCandidates.slice(0, 10).map(compactBattlefieldCandidate);
  }
  if (Array.isArray(payload.atlasScoreCandidates)) {
    compact.atlasScoreCandidates = payload.atlasScoreCandidates.slice(0, 8).map(compactUnknown);
  }
  if (Array.isArray(payload.rows)) {
    compact.rows = payload.rows.slice(-12).map((row) => {
      const record = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : {};
      return {
        key: truncateStoredValue(record.key, 80),
        text: truncateStoredValue(record.text, 200)
      };
    });
  }
  return compact;
}

function compactBattlefieldCandidate(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    side: truncateStoredValue(record.side, 20),
    text: truncateStoredValue(record.text, 140),
    code: truncateStoredValue(record.code, 40),
    image: truncateStoredValue(record.image, 300),
    hidden: record.hidden === true,
    capturedAt: truncateStoredValue(record.capturedAt, 40)
  };
}

function compactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateStoredValue(value, 320);
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 12).map(compactUnknown);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 20)
        .map(([key, nested]) => [key, compactUnknown(nested)])
    );
  }
  return "";
}

function truncateStoredValue(value: unknown, limit: number): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function isDatabaseMalformedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database disk image is malformed|database corruption|malformed database|file is not a database/i.test(message);
}

function savedDeckFromRow(row: unknown[]): SavedDeck {
  return {
    id: readString(row[0]),
    sourceUrl: readString(row[1]),
    sourceKey: readString(row[2]),
    title: readString(row[3]),
    legend: normalizeLegendName(row[4]),
    snapshotJson: readString(row[5]),
    lastImportedAt: readString(row[6]),
    lastRefreshStatus: readString(row[7]),
    lastRefreshError: readString(row[8])
  };
}

function parseGames(raw: string, row: Record<string, unknown>): MatchDraft["games"] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
      const games = parsed.map((game, index) => ({
        gameNumber: index + 1,
        result: readResult(game.result),
        myPoints: readNumber(game.my_points ?? game.myPoints),
        oppPoints: readNumber(game.opp_points ?? game.oppPoints),
        myBattlefield: readString(game.my_bf ?? game.myBattlefield),
        oppBattlefield: readString(game.opp_bf ?? game.oppBattlefield),
        extraBattlefields: readStringArray(game.extraBattlefields ?? game.extra_battlefields ?? game.specialBattlefields),
        wentFirst: readWentFirst(game.went_first ?? game.wentFirst)
      }));
      if (games.length) return games;
    } catch {
      // Fall through to single-game fallback.
    }
  }
  return [{
    gameNumber: 1,
    result: readResult(row.result),
    myBattlefield: readString(row.my_battlefield),
    oppBattlefield: readString(row.opp_battlefield),
    extraBattlefields: [],
    wentFirst: readWentFirst(row.went_first)
  }];
}

function normalizeLegacyDate(value: string): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function readFormat(value: unknown): MatchDraft["format"] {
  const raw = readString(value).toLowerCase().replace(/\s+/g, "");
  if (raw === "bo3" || raw === "bestof3") return "Bo3";
  if (raw === "auto") return "Auto";
  return "Bo1";
}

function readResult(value: unknown): MatchDraft["result"] {
  const raw = readString(value);
  if (raw === "Win" || raw === "Loss" || raw === "Draw" || raw === "Incomplete") return raw;
  return "Incomplete";
}

function readWentFirst(value: unknown): "1st" | "2nd" | "" {
  const raw = readString(value);
  return raw === "1st" || raw === "2nd" ? raw : "";
}

function readNumber(value: unknown): number | undefined {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(readString).filter(Boolean);
  }
  const raw = readString(value);
  return raw ? raw.split(/[,|]/).map(readString).filter(Boolean) : [];
}

function readString(value: unknown): string {
  return String(value ?? "").trim();
}
