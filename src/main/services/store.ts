import { app } from "electron";
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { deckNotebookWithCurrentVersion, deckSnapshotHash, emptyDeckNotebook, normalizeDeckNotebook, sanitizeDeckNotebookForDeck } from "../../shared/deckNotebook.js";
import { normalizeLegendName } from "../../shared/legendNames.js";
import { buildCombinedBo3Match, buildMatchCombinePreview, markOriginalAsCombined, restoreCombinedOriginal, type MatchCombinePreview, type MatchCombineSavePayload } from "../../shared/matchCombine.js";
import type { CaptureEvent, DeckNotebook, ImportSummary, MatchDraft, OverlayDisplayOptions, ReplayRecord, RiftLiteBackupFile, RiftLiteBackupOptions, SavedDeck, UserSettings } from "../../shared/types.js";
import { sanitizeBackupFile } from "./backupSanitizer.js";
import { redactCorruptSettingsText, redactSensitiveSettings, sensitiveCredentialPatch, stripLegacyHubSecrets, type SecureCredentialVault } from "./secureCredentialVault.js";

interface PersistedState {
  settings?: Partial<UserSettings>;
  matches?: MatchDraft[];
}

const require = createRequire(import.meta.url);
const DATABASE_BACKUP_RETENTION = 10;
const DATABASE_BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
const OLD_RAW_CAPTURE_ENDPOINT = "https://test.riftreplay.com/api/v1/replays";
const DEFAULT_RAW_CAPTURE_ENDPOINT = "https://riftreplay.com/api/v1/replays";

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
  accountLastVerifiedAt: "",
  accountLastVerificationError: "",
  accountCloudSyncEnabled: false,
  accountCloudSyncLastSyncedAt: "",
  accountCloudSyncLastRestoredAt: "",
  accountCloudSyncDeviceId: "",
  accountCloudSyncDeviceName: "",
  accountCloudSyncLastError: "",
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
  replayCustomFlagTypes: ["Mistake Consequence", "Question", "Alternative Line"],
  replayShadowClipEnabled: false,
  replayShadowClipSeconds: 60,
  replayShadowClipHotkey: "CommandOrControl+Shift+C",
  replayShadowClipHotkeyEnabled: true,
  replayQuickFlagHotkey: "CommandOrControl+Shift+F",
  replayQuickFlagHotkeyEnabled: true,
  rawCapture: {
    enabled: false,
    webReplayAutoUploadEnabled: false,
    webReplayAutoUploadAccountUid: "",
    webReplayDiscordShareEnabled: false,
    webReplayDiscordShareAccountUid: "",
    webReplayDiscordShareHubIds: [],
    uploadEnabled: false,
    endpoint: DEFAULT_RAW_CAPTURE_ENDPOINT,
    apiKey: "",
    visibility: "private"
  },
  deckTrackerEnabled: false,
  deckTrackerAutoStart: false,
  deckTrackerSaveToReplay: false,
  deckTrackerPerformanceMode: "balanced",
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
  activeHubs: [],
  privateHubWebReplayGrantKeys: [],
  activeTeams: []
};

function normalizeReplayVideoMode(_value: unknown): UserSettings["replayVideoMode"] {
  return "game-frame";
}

function normalizeReplayFramePreset(value: unknown): UserSettings["replayFramePreset"] {
  return value === "light" || value === "detailed" ? value : "standard";
}

function uniqueReplayCustomFlagTypes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const label = String(item ?? "").trim().replace(/\s+/g, " ");
    const key = label.toLowerCase();
    if (!label || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(label.slice(0, 48));
  }
  return result.slice(0, 24);
}

function normalizeRawCaptureSettings(value: unknown, fallback = DEFAULT_SETTINGS.rawCapture): UserSettings["rawCapture"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const raw = value as Partial<UserSettings["rawCapture"]>;
  const endpointValue = typeof raw.endpoint === "string" && raw.endpoint.trim()
    ? raw.endpoint.trim()
    : DEFAULT_RAW_CAPTURE_ENDPOINT;
  const endpoint = endpointValue === OLD_RAW_CAPTURE_ENDPOINT ? DEFAULT_RAW_CAPTURE_ENDPOINT : endpointValue;
  const storedVisibility = (raw as Record<string, unknown>).visibility;
  const rawVisibility = typeof storedVisibility === "string" ? storedVisibility : "";
  const hasSeparateUploadConsent = typeof raw.uploadEnabled === "boolean";
  const hasWebReplayUploadConsent = typeof raw.webReplayAutoUploadEnabled === "boolean";
  const webReplayAutoUploadAccountUid = hasWebReplayUploadConsent && typeof raw.webReplayAutoUploadAccountUid === "string"
    ? raw.webReplayAutoUploadAccountUid.trim()
    : "";
  const hasDiscordShareConsent = typeof raw.webReplayDiscordShareEnabled === "boolean";
  const webReplayDiscordShareAccountUid = hasDiscordShareConsent && typeof raw.webReplayDiscordShareAccountUid === "string"
    ? raw.webReplayDiscordShareAccountUid.trim()
    : "";
  const webReplayDiscordShareHubIds = hasDiscordShareConsent && Array.isArray(raw.webReplayDiscordShareHubIds)
    ? Array.from(new Set(raw.webReplayDiscordShareHubIds.map((value) => String(value ?? "").trim()).filter(Boolean))).slice(0, 10)
    : [];
  const visibility = hasSeparateUploadConsent && rawVisibility === "public"
    ? "public"
    : hasSeparateUploadConsent && (rawVisibility === "unlisted" || rawVisibility === "friends")
      ? "unlisted"
      : "private";
  return {
    // Legacy raw-capture settings predate separate capture/upload consent and
    // lived behind hidden UI. Treat them as opted out during normalization.
    enabled: hasSeparateUploadConsent && raw.enabled === true,
    webReplayAutoUploadEnabled: hasWebReplayUploadConsent && raw.webReplayAutoUploadEnabled === true,
    webReplayAutoUploadAccountUid,
    webReplayDiscordShareEnabled: hasDiscordShareConsent && raw.webReplayDiscordShareEnabled === true,
    webReplayDiscordShareAccountUid,
    webReplayDiscordShareHubIds,
    uploadEnabled: hasSeparateUploadConsent && raw.uploadEnabled === true,
    endpoint,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    visibility
  };
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
    if (key === "overlayDisplay" || key === "activeHubs" || key === "activeTeams") {
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

  const activeTeamsMatch = value.match(/"activeTeams"\s*:\s*(\[[^\]]*\])/);
  if (activeTeamsMatch) {
    const parsed = parseJsonToken<unknown>(activeTeamsMatch[1]);
    if (Array.isArray(parsed)) {
      recovered.activeTeams = parsed;
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
  private matchesCache: MatchDraft[] | null = null;
  private matchesLoadPromise: Promise<MatchDraft[]> | null = null;
  private replaysCache: ReplayRecord[] | null = null;
  private replaysLoadPromise: Promise<ReplayRecord[]> | null = null;
  private lastDatabaseBackupAt = 0;
  private persistQueue: Promise<void> = Promise.resolve();
  private legacyJsonPendingFinalization = false;

  constructor(
    dbPath = join(app.getPath("userData"), "riftlite-v06.sqlite"),
    legacyJsonPath = join(app.getPath("userData"), "riftlite-v06-store.json"),
    private readonly credentialVault?: SecureCredentialVault,
    private readonly legacyImportEnabled = false
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
    const legacyHubSecretWasPresent = Array.isArray(parsed.activeHubs) &&
      parsed.activeHubs.some((hub) => Boolean(hub?.passwordHash));
    const normalized = this.normalizeSettings(parsed);
    const protectedSettings = this.credentialVault
      ? await this.credentialVault.reconcile(normalized)
      : {
          runtimeSettings: normalized,
          persistedSettings: normalized,
          protected: false,
          storageChanged: legacyHubSecretWasPresent
        };
    protectedSettings.storageChanged = protectedSettings.storageChanged || legacyHubSecretWasPresent;
    this.settingsCache = protectedSettings.runtimeSettings;
    if (repairedCorruptSettings || protectedSettings.storageChanged) {
      db.run("INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)", [
        "settings",
        JSON.stringify(protectedSettings.persistedSettings),
        Date.now()
      ]);
      await this.persist({ skipPrewriteBackup: protectedSettings.protected && protectedSettings.storageChanged });
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
      replayCustomFlagTypes: Array.isArray(parsed.replayCustomFlagTypes)
        ? uniqueReplayCustomFlagTypes(parsed.replayCustomFlagTypes)
        : DEFAULT_SETTINGS.replayCustomFlagTypes,
      rawCapture: normalizeRawCaptureSettings((parsed as { rawCapture?: unknown }).rawCapture),
      deckTrackerPinnedCards: parsed.deckTrackerPinnedCards && typeof parsed.deckTrackerPinnedCards === "object" && !Array.isArray(parsed.deckTrackerPinnedCards)
        ? parsed.deckTrackerPinnedCards
        : {},
      activeHubs: stripLegacyHubSecrets({
        ...DEFAULT_SETTINGS,
        ...parsed,
        rawCapture: normalizeRawCaptureSettings((parsed as { rawCapture?: unknown }).rawCapture),
        activeHubs: Array.isArray(parsed.activeHubs) ? parsed.activeHubs : [],
        activeTeams: Array.isArray(parsed.activeTeams) ? parsed.activeTeams : []
      }).activeHubs,
      privateHubWebReplayGrantKeys: Array.isArray(parsed.privateHubWebReplayGrantKeys)
        ? [...new Set(parsed.privateHubWebReplayGrantKeys.filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-10_000)
        : [],
      activeTeams: Array.isArray(parsed.activeTeams) ? parsed.activeTeams : []
    };
  }

  private async backupCorruptSettings(value: string): Promise<void> {
    const backupPath = join(dirname(this.dbPath), `riftlite-settings-corrupt-${Date.now()}.json`);
    await writeFile(backupPath, redactCorruptSettingsText(value), "utf8").catch(() => undefined);
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
      replayCustomFlagTypes: Object.prototype.hasOwnProperty.call(patch, "replayCustomFlagTypes")
        ? uniqueReplayCustomFlagTypes(patch.replayCustomFlagTypes)
        : current.replayCustomFlagTypes,
      rawCapture: Object.prototype.hasOwnProperty.call(patch, "rawCapture")
        ? normalizeRawCaptureSettings((patch as { rawCapture?: unknown }).rawCapture, current.rawCapture)
        : current.rawCapture,
      activeHubs: patch.activeHubs ? [...patch.activeHubs] : current.activeHubs,
      privateHubWebReplayGrantKeys: Object.prototype.hasOwnProperty.call(patch, "privateHubWebReplayGrantKeys")
        ? [...new Set((patch.privateHubWebReplayGrantKeys ?? []).filter((value) => typeof value === "string" && value.length > 0))].slice(-10_000)
        : current.privateHubWebReplayGrantKeys,
      activeTeams: patch.activeTeams ? [...patch.activeTeams] : current.activeTeams
    };
    const sanitizedNext = stripLegacyHubSecrets(next);
    const protectedSettings = this.credentialVault
      ? await this.credentialVault.protectForSave(sanitizedNext, sensitiveCredentialPatch(patch))
      : {
          runtimeSettings: sanitizedNext,
          persistedSettings: sanitizedNext
        };
    const db = await this.database();
    db.run("INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)", [
      "settings",
      JSON.stringify(protectedSettings.persistedSettings),
      Date.now()
    ]);
    this.settingsCache = protectedSettings.runtimeSettings;
    await this.persist();
    return protectedSettings.runtimeSettings;
  }

  async getMatches(): Promise<MatchDraft[]> {
    return (await this.readAllMatches()).filter((match) => !match.deletedAt);
  }

  async getDeletedMatches(): Promise<MatchDraft[]> {
    return [...(await this.readAllMatches())]
      .filter((match) => Boolean(match.deletedAt))
      .sort((a, b) => Date.parse(b.updatedAt || b.capturedAt) - Date.parse(a.updatedAt || a.capturedAt));
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
    this.invalidateMatchCache();
    return next;
  }

  async previewCombinedMatches(matchIds: string[]): Promise<MatchCombinePreview> {
    const matches = await this.getMatchesByIds(matchIds);
    return buildMatchCombinePreview(matches);
  }

  async combineMatches(payload: MatchCombineSavePayload): Promise<MatchDraft> {
    const orderedMatchIds = payload.orderedMatchIds.filter(Boolean).slice(0, 3);
    const matches = await this.getMatchesByIds(orderedMatchIds);
    const preview = buildMatchCombinePreview(matches);
    if (!preview.canSave) {
      const error = preview.warnings.find((warning) => warning.severity === "error")?.message ?? "Those matches cannot be combined.";
      throw new Error(error);
    }

    const db = await this.database();
    const now = new Date().toISOString();
    const combined = compactMatchForStorage(normalizeStoredMatch(buildCombinedBo3Match(matches, randomUUID(), now)));
    const originals = matches.map((match) => compactMatchForStorage(normalizeStoredMatch(markOriginalAsCombined(match, combined.id, now))));

    await this.withDatabaseRepair("combine-matches", async () => {
      db.run(
        `INSERT OR REPLACE INTO matches
         (id, platform, status, result, captured_at, updated_at, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [combined.id, combined.platform, combined.status, combined.result, combined.capturedAt, combined.updatedAt, JSON.stringify(combined)]
      );
      for (const original of originals) {
        db.run(
          "UPDATE matches SET updated_at=?, data_json=? WHERE id=?",
          [original.updatedAt, JSON.stringify(original), original.id]
        );
      }
      await this.persist();
    });
    this.invalidateMatchCache();
    return combined;
  }

  async undoCombinedMatch(combinedMatchId: string): Promise<MatchDraft[]> {
    const db = await this.database();
    const row = db.exec("SELECT data_json FROM matches WHERE id=?", [combinedMatchId])[0]?.values[0]?.[0];
    if (typeof row !== "string") {
      throw new Error("Combined match was not found.");
    }
    const combined = normalizeStoredMatch(JSON.parse(row) as MatchDraft);
    if (!combined.manualRepair || !combined.combinedFromMatchIds?.length) {
      throw new Error("That match is not a combined Bo3 repair.");
    }

    const now = new Date().toISOString();
    const restored: MatchDraft[] = [];
    await this.withDatabaseRepair("undo-combined-match", async () => {
      const deletedCombined = normalizeStoredMatch({ ...combined, deletedAt: now, updatedAt: now });
      db.run(
        "UPDATE matches SET updated_at=?, data_json=? WHERE id=?",
        [deletedCombined.updatedAt, JSON.stringify(deletedCombined), deletedCombined.id]
      );
      for (const originalId of combined.combinedFromMatchIds ?? []) {
        const originalRow = db.exec("SELECT data_json FROM matches WHERE id=?", [originalId])[0]?.values[0]?.[0];
        if (typeof originalRow !== "string") {
          continue;
        }
        const original = normalizeStoredMatch(JSON.parse(originalRow) as MatchDraft);
        const next = compactMatchForStorage(normalizeStoredMatch(restoreCombinedOriginal(original, now)));
        db.run("UPDATE matches SET updated_at=?, data_json=? WHERE id=?", [next.updatedAt, JSON.stringify(next), next.id]);
        restored.push(next);
      }
      await this.persist();
    });
    this.invalidateMatchCache();
    return restored;
  }

  private async getMatchesByIds(matchIds: string[]): Promise<MatchDraft[]> {
    const cached = this.matchesCache ?? null;
    if (cached) {
      const matches = new Map(cached.filter((match) => !match.deletedAt).map((match) => [match.id, match]));
      return matchIds.map((id) => matches.get(id)).filter((match): match is MatchDraft => Boolean(match));
    }
    const db = await this.database();
    const matches = new Map<string, MatchDraft>();
    for (const id of new Set(matchIds.filter(Boolean))) {
      const row = db.exec("SELECT data_json FROM matches WHERE id=?", [id])[0]?.values[0]?.[0];
      if (typeof row === "string") {
        const match = normalizeStoredMatch(JSON.parse(row) as MatchDraft);
        if (!match.deletedAt) {
          matches.set(id, match);
        }
      }
    }
    return matchIds.map((id) => matches.get(id)).filter((match): match is MatchDraft => Boolean(match));
  }

  private async readAllMatches(): Promise<MatchDraft[]> {
    if (this.matchesCache) {
      return this.matchesCache;
    }
    if (this.matchesLoadPromise) {
      return this.matchesLoadPromise;
    }
    this.matchesLoadPromise = (async () => {
      const db = await this.database();
      const result = db.exec("SELECT data_json FROM matches ORDER BY captured_at DESC");
      const matches = (result[0]?.values ?? [])
        .map((row) => this.parseStoredMatch(row[0]))
        .filter((match): match is MatchDraft => Boolean(match));
      this.matchesCache = matches;
      return matches;
    })();
    try {
      return await this.matchesLoadPromise;
    } finally {
      this.matchesLoadPromise = null;
    }
  }

  private invalidateMatchCache(): void {
    this.matchesCache = null;
    this.matchesLoadPromise = null;
  }

  async deleteMatch(id: string): Promise<void> {
    const db = await this.database();
    const row = db.exec("SELECT data_json FROM matches WHERE id=?", [id])[0]?.values[0]?.[0];
    if (typeof row === "string") {
      const now = new Date().toISOString();
      const match = normalizeStoredMatch({ ...JSON.parse(row) as MatchDraft, deletedAt: now, updatedAt: now });
      db.run("UPDATE matches SET updated_at=?, data_json=? WHERE id=?", [match.updatedAt, JSON.stringify(match), id]);
      await this.deleteReplayByMatch(id, now);
      this.invalidateMatchCache();
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
    this.invalidateMatchCache();
    return match;
  }

  async purgeMatch(id: string): Promise<void> {
    const db = await this.database();
    db.run("DELETE FROM matches WHERE id=?", [id]);
    db.run("DELETE FROM replays WHERE match_id=?", [id]);
    await this.persist();
    this.invalidateMatchCache();
    this.invalidateReplayCache();
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

  async getDeckNotebooks(): Promise<DeckNotebook[]> {
    const db = await this.database();
    const result = db.exec("SELECT deck_id, data_json FROM deck_notebooks ORDER BY updated_at DESC");
    return (result[0]?.values ?? []).map((row) => {
      const deckId = readString(row[0]);
      try {
        return normalizeDeckNotebook(deckId, JSON.parse(String(row[1])) as DeckNotebook);
      } catch {
        return emptyDeckNotebook(deckId);
      }
    }).filter((notebook) => notebook.deckId);
  }

  async getReplays(): Promise<ReplayRecord[]> {
    return (await this.readAllReplays()).filter((replay) => !replay.deletedAt);
  }

  async getDeletedReplays(): Promise<ReplayRecord[]> {
    return (await this.readAllReplays()).filter((replay) => Boolean(replay.deletedAt));
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
      this.invalidateReplayCache();
      await this.persist();
    });
    return next;
  }

  async updateReplay(
    id: string,
    update: (current: ReplayRecord) => ReplayRecord
  ): Promise<ReplayRecord | null> {
    const db = await this.database();
    let saved: ReplayRecord | null = null;
    await this.withDatabaseRepair("update-replay", async () => {
      const row = db.exec("SELECT data_json FROM replays WHERE id=?", [id])[0]?.values[0]?.[0];
      const current = this.parseStoredReplay(row);
      if (!current) {
        saved = null;
        return;
      }
      const candidate = update(current);
      const next = compactReplayForStorage({
        ...candidate,
        id: current.id,
        matchId: current.matchId,
        platform: current.platform,
        capturedAt: current.capturedAt
      });
      db.run("UPDATE replays SET data_json=? WHERE id=?", [JSON.stringify(next), id]);
      this.invalidateReplayCache();
      await this.persist();
      saved = next;
    });
    return saved;
  }

  async deleteReplay(id: string): Promise<void> {
    const db = await this.database();
    const now = new Date().toISOString();
    const row = db.exec("SELECT data_json FROM replays WHERE id=?", [id])[0]?.values[0]?.[0];
    if (typeof row === "string") {
      const replay = { ...JSON.parse(row) as ReplayRecord, deletedAt: now };
      db.run("UPDATE replays SET data_json=? WHERE id=?", [JSON.stringify(replay), id]);
      await this.persist();
      this.invalidateReplayCache();
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
    this.invalidateReplayCache();
    return replay;
  }

  async purgeReplay(id: string): Promise<void> {
    const db = await this.database();
    db.run("DELETE FROM replays WHERE id=?", [id]);
    await this.persist();
    this.invalidateReplayCache();
  }

  async deleteReplayByMatch(matchId: string, deletedAt = new Date().toISOString()): Promise<void> {
    const db = await this.database();
    const result = db.exec("SELECT id, data_json FROM replays WHERE match_id=?", [matchId]);
    for (const row of result[0]?.values ?? []) {
      const replay = { ...JSON.parse(String(row[1])) as ReplayRecord, deletedAt };
      db.run("UPDATE replays SET data_json=? WHERE id=?", [JSON.stringify(replay), String(row[0])]);
    }
    await this.persist();
    this.invalidateReplayCache();
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
    this.invalidateReplayCache();
  }

  private async readAllReplays(): Promise<ReplayRecord[]> {
    if (this.replaysCache) {
      return this.replaysCache;
    }
    if (this.replaysLoadPromise) {
      return this.replaysLoadPromise;
    }
    this.replaysLoadPromise = (async () => {
      const db = await this.database();
      const result = db.exec("SELECT data_json FROM replays ORDER BY captured_at DESC");
      const replays = (result[0]?.values ?? [])
        .map((row) => this.parseStoredReplay(row[0]))
        .filter((replay): replay is ReplayRecord => Boolean(replay));
      this.replaysCache = replays;
      return replays;
    })();
    try {
      return await this.replaysLoadPromise;
    } finally {
      this.replaysLoadPromise = null;
    }
  }

  private invalidateReplayCache(): void {
    this.replaysCache = null;
    this.replaysLoadPromise = null;
  }

  async exportBackupData(options: Partial<RiftLiteBackupOptions> = {}): Promise<RiftLiteBackupFile> {
    const includeRecycleBin = options.includeRecycleBin !== false;
    return sanitizeBackupFile({
      format: "riftlite.backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      settings: redactSensitiveSettings(await this.getSettings()),
      matches: await this.getMatches(),
      deletedMatches: includeRecycleBin ? await this.getDeletedMatches() : [],
      decks: await this.getSavedDecks(),
      notebooks: await this.getDeckNotebooks(),
      replays: await this.getReplays(),
      deletedReplays: includeRecycleBin ? await this.getDeletedReplays() : []
    });
  }

  async restoreBackupData(backup: RiftLiteBackupFile, options: { preserveAccount?: boolean; preserveReplays?: boolean } = {}): Promise<void> {
    if (backup.format !== "riftlite.backup" || backup.version !== 1) {
      throw new Error("That backup file is not a supported RiftLite backup.");
    }
    const currentSettings = await this.getSettings();
    const activeDb = await this.database();
    if (!this.sql) {
      throw new Error("RiftLite database did not initialize");
    }

    // Persist and snapshot the exact live state before attempting any destructive
    // import. The restore itself is built in an isolated sql.js clone so a bad row
    // or failed disk write cannot leave the active database half-replaced.
    await this.persist();
    await this.createLastKnownGoodBackup("pre-restore", true);
    let candidateDb: Database | null = new this.sql.Database(activeDb.export());

    try {
      candidateDb.run("DELETE FROM matches");
      if (!options.preserveReplays) {
        candidateDb.run("DELETE FROM replays");
      }
      candidateDb.run("DELETE FROM saved_decks");
      candidateDb.run("DELETE FROM deck_notebooks");

      const restoredSettings = this.normalizeSettings(backup.settings ?? {});
      // Secure credentials are device-bound and intentionally absent from
      // backup files. Keep their matching account/Scorepad/config identity on
      // any secure-vault restore so an imported backup cannot pair the current
      // token or device secret with another device's public identifiers.
      const preserveDeviceIdentity = options.preserveAccount || Boolean(this.credentialVault);
      const settings = preserveDeviceIdentity
        ? this.normalizeSettings({
            ...restoredSettings,
            firebaseUid: currentSettings.firebaseUid,
            firebaseRefreshToken: currentSettings.firebaseRefreshToken,
            accountUid: currentSettings.accountUid,
            accountEmail: currentSettings.accountEmail,
            accountHandle: currentSettings.accountHandle,
            accountDisplayName: currentSettings.accountDisplayName,
            accountProfilePublic: currentSettings.accountProfilePublic,
            accountLastVerifiedAt: currentSettings.accountLastVerifiedAt,
            accountLastVerificationError: currentSettings.accountLastVerificationError,
            accountCloudSyncEnabled: currentSettings.accountCloudSyncEnabled,
            accountCloudSyncLastSyncedAt: currentSettings.accountCloudSyncLastSyncedAt,
            accountCloudSyncLastRestoredAt: currentSettings.accountCloudSyncLastRestoredAt,
            accountCloudSyncDeviceId: currentSettings.accountCloudSyncDeviceId,
            accountCloudSyncDeviceName: currentSettings.accountCloudSyncDeviceName,
            accountCloudSyncLastError: currentSettings.accountCloudSyncLastError,
            rawCapture: currentSettings.rawCapture,
            scorepadDeviceId: currentSettings.scorepadDeviceId,
            scorepadDeviceSecret: currentSettings.scorepadDeviceSecret,
            scorepadLinkedAt: currentSettings.scorepadLinkedAt,
            screenshotDirectory: currentSettings.screenshotDirectory,
            replayDirectory: currentSettings.replayDirectory
          })
        : restoredSettings;
      candidateDb.run("INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)", [
        "settings",
        JSON.stringify(redactSensitiveSettings(settings)),
        Date.now()
      ]);

      const matches = [...(backup.matches ?? []), ...(backup.deletedMatches ?? [])];
      for (const match of matches) {
        const next = compactMatchForStorage(normalizeStoredMatch(match));
        candidateDb.run(
          `INSERT OR REPLACE INTO matches
           (id, platform, status, result, captured_at, updated_at, data_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            next.id,
            next.platform,
            next.status,
            next.result,
            next.capturedAt,
            next.updatedAt,
            JSON.stringify(next)
          ]
        );
      }

      for (const deck of backup.decks ?? []) {
        const next = normalizeStoredDeck(deck);
        candidateDb.run(
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
      }

      for (const notebook of backup.notebooks ?? []) {
        if (notebook.deckId) {
          this.writeDeckNotebook(candidateDb, notebook.deckId, notebook);
        }
      }

      for (const deck of backup.decks ?? []) {
        const normalizedDeck = normalizeStoredDeck(deck);
        this.ensureDeckNotebookCurrentVersion(candidateDb, normalizedDeck);
      }

      if (!options.preserveReplays) {
        const replays = [...(backup.replays ?? []), ...(backup.deletedReplays ?? [])];
        for (const replay of replays) {
          const next = compactReplayForStorage(replay);
          candidateDb.run(
            `INSERT OR REPLACE INTO replays
             (id, match_id, platform, captured_at, data_json)
             VALUES (?, ?, ?, ?, ?)`,
            [next.id, next.matchId, next.platform, next.capturedAt, JSON.stringify(next)]
          );
        }
      }

      const integrityIssue = this.databaseIntegrityIssue(candidateDb);
      if (integrityIssue) {
        throw new Error(`Restored RiftLite backup failed validation: ${integrityIssue}`);
      }

      await this.writeDatabaseFile(candidateDb);
      this.db = candidateDb;
      candidateDb = null;
      try {
        activeDb.close();
      } catch {
        // The validated replacement is already active and safely persisted.
      }
      this.invalidateMatchCache();
      this.invalidateReplayCache();
      this.settingsCache = null;
    } catch (error) {
      candidateDb?.close();
      throw error;
    }
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
      this.invalidateMatchCache();
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
    try {
      this.db = bytes?.length ? new this.sql.Database(bytes) : new this.sql.Database();
      await this.repairDatabaseIfNeeded("startup-integrity-check");
      this.migrateSchema();
      await this.migrateLegacyJson();
      if (this.legacyImportEnabled) {
        await this.importLegacyData().catch(() => undefined);
      }
      await this.repairDatabaseIfNeeded("post-migration-integrity-check");
      // Hydrate/migrate credentials before taking the startup snapshot so a
      // newly-created recovery backup does not preserve legacy plaintext.
      await this.getSettings();
      await this.persist();
      await this.finalizeLegacyJsonMigration();
      await this.createLastKnownGoodBackup("startup-ok", true).catch(() => undefined);
    } catch (error) {
      await this.recoverFromStartupOpenFailure(error);
    }
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
    // Ensure replaced settings pages are zeroed instead of leaving deleted
    // plaintext credential bytes in SQLite free pages.
    db.run("PRAGMA secure_delete=ON");
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
    const migratedPath = `${this.legacyJsonPath}.migrated`;
    if (!db) {
      return;
    }
    if (existsSync(migratedPath)) {
      await this.scrubLegacySettingsJson(migratedPath);
      if (existsSync(this.legacyJsonPath)) {
        await this.scrubLegacySettingsJson(this.legacyJsonPath);
      }
      return;
    }
    if (!existsSync(this.legacyJsonPath)) {
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
        // Force the normal settings loader to migrate any legacy credentials
        // into the secure vault before these values are exposed or backed up.
        this.settingsCache = null;
      }
      for (const match of parsed.matches ?? []) {
        db.run(
          `INSERT OR IGNORE INTO matches
           (id, platform, status, result, captured_at, updated_at, data_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [match.id, match.platform, match.status, match.result, match.capturedAt, match.updatedAt, JSON.stringify(match)]
        );
      }
      // The source stays intact until the vault and SQLite export are durable.
      // finalizeLegacyJsonMigration then retains a sanitized archive.
      this.legacyJsonPendingFinalization = true;
      this.invalidateMatchCache();
    } catch {
      return;
    }
  }

  private async finalizeLegacyJsonMigration(): Promise<void> {
    if (!this.legacyJsonPendingFinalization || !existsSync(this.legacyJsonPath)) {
      return;
    }
    const migratedPath = `${this.legacyJsonPath}.migrated`;
    await this.scrubLegacySettingsJson(this.legacyJsonPath);
    await rename(this.legacyJsonPath, migratedPath);
    this.legacyJsonPendingFinalization = false;
  }

  private async scrubLegacySettingsJson(path: string): Promise<void> {
    let raw = "";
    try {
      raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed.settings) {
        return;
      }
      parsed.settings = redactSensitiveSettings(this.normalizeSettings(parsed.settings));
      await writeFile(path, JSON.stringify(parsed), { encoding: "utf8", mode: 0o600 });
    } catch {
      if (raw) {
        await writeFile(path, redactCorruptSettingsText(raw), { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
      }
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

  private parseStoredMatch(raw: unknown): MatchDraft | null {
    if (typeof raw !== "string") {
      return null;
    }
    try {
      return normalizeStoredMatch(JSON.parse(raw) as MatchDraft);
    } catch (error) {
      console.warn("Skipping unreadable stored match row", error);
      return null;
    }
  }

  private parseStoredReplay(raw: unknown): ReplayRecord | null {
    if (typeof raw !== "string") {
      return null;
    }
    try {
      return compactReplayForStorage(JSON.parse(raw) as ReplayRecord);
    } catch (error) {
      console.warn("Skipping unreadable stored replay row", error);
      return null;
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

  private async persist(options: { skipPrewriteBackup?: boolean } = {}): Promise<void> {
    const persistAfterPrevious = this.persistQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this.db) {
          return;
        }
        if (!options.skipPrewriteBackup) {
          await this.createLastKnownGoodBackup("prewrite").catch(() => undefined);
        }
        await this.writeDatabaseFile(this.db);
      });
    this.persistQueue = persistAfterPrevious;
    await persistAfterPrevious;
  }

  private async writeDatabaseFile(database: Database): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    const tempPath = `${this.dbPath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    await writeFile(tempPath, Buffer.from(database.export()));
    try {
      await rename(tempPath, this.dbPath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
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

  private databaseIntegrityIssue(database = this.db): string {
    if (!database) {
      return "";
    }
    try {
      const value = String(database.exec("PRAGMA integrity_check")[0]?.values?.[0]?.[0] ?? "");
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
    await this.persist();
  }

  private async recoverFromStartupOpenFailure(error: unknown): Promise<void> {
    const preservedPath = await this.backupDatabase("startup-open-failed");
    const failurePath = join(dirname(this.dbPath), `riftlite-startup-open-failed-${Date.now()}.log`);
    const errorText = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    await writeFile(
      failurePath,
      errorText,
      "utf8"
    ).catch(() => undefined);
    if (!this.sql) {
      throw error;
    }
    if (await this.restoreLatestUsableDatabaseBackup("startup-open-failed")) {
      return;
    }
    this.db?.close();
    this.db = new this.sql.Database();
    this.settingsCache = null;
    this.matchesCache = null;
    this.replaysCache = null;
    this.migrateSchema();
    await this.migrateLegacyJson().catch(() => undefined);
    if (this.legacyImportEnabled) {
      await this.importLegacyData().catch(() => undefined);
    }
    await this.getSettings();
    await this.persist();
    await this.finalizeLegacyJsonMigration().catch(() => undefined);
    await this.createLastKnownGoodBackup("startup-fresh-after-corrupt-db", true).catch(() => undefined);
    await writeFile(
      failurePath,
      `${errorText}\n\nNo usable automatic database backup was found. RiftLite preserved the unreadable database at ${preservedPath || this.dbPath} and started with a fresh local database.`,
      "utf8"
    ).catch(() => undefined);
  }

  private async backupDatabase(context: string): Promise<string> {
    if (!existsSync(this.dbPath)) {
      return "";
    }
    const safeContext = context.replace(/[^a-z0-9-]+/gi, "-").slice(0, 40) || "repair";
    const backupPath = join(dirname(this.dbPath), `riftlite-v06-${safeContext}-backup-${Date.now()}.sqlite`);
    await copyFile(this.dbPath, backupPath).catch(() => undefined);
    return backupPath;
  }

  private databaseBackupDirectory(): string {
    return join(dirname(this.dbPath), "database-backups");
  }

  private async createLastKnownGoodBackup(context: string, force = false): Promise<string> {
    if (!existsSync(this.dbPath)) {
      return "";
    }
    const now = Date.now();
    if (!force && now - this.lastDatabaseBackupAt < DATABASE_BACKUP_MIN_INTERVAL_MS) {
      return "";
    }
    const directory = this.databaseBackupDirectory();
    await mkdir(directory, { recursive: true });
    const safeContext = context.replace(/[^a-z0-9-]+/gi, "-").slice(0, 32) || "snapshot";
    const backupPath = join(directory, `riftlite-v06-auto-${safeContext}-${now}.sqlite`);
    await copyFile(this.dbPath, backupPath);
    this.lastDatabaseBackupAt = now;
    await this.pruneLastKnownGoodBackups();
    return backupPath;
  }

  private async pruneLastKnownGoodBackups(): Promise<void> {
    const files = await this.listAutoBackupFiles();
    for (const file of files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(DATABASE_BACKUP_RETENTION)) {
      await unlink(file.path).catch(() => undefined);
    }
  }

  private async listAutoBackupFiles(): Promise<Array<{ path: string; mtimeMs: number }>> {
    const directory = this.databaseBackupDirectory();
    if (!existsSync(directory)) {
      return [];
    }
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const files: Array<{ path: string; mtimeMs: number }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^riftlite-v06-auto-.*\.sqlite$/i.test(entry.name)) {
        continue;
      }
      const path = join(directory, entry.name);
      const info = await stat(path).catch(() => null);
      if (info) {
        files.push({ path, mtimeMs: info.mtimeMs });
      }
    }
    return files;
  }

  private async listRecoveryBackupCandidates(): Promise<Array<{ path: string; mtimeMs: number }>> {
    const directories = [this.databaseBackupDirectory(), dirname(this.dbPath)];
    const seen = new Set<string>();
    const files: Array<{ path: string; mtimeMs: number }> = [];
    for (const directory of directories) {
      if (!existsSync(directory)) {
        continue;
      }
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const isCandidate =
          /^riftlite-v06-auto-.*\.sqlite$/i.test(entry.name) ||
          /^riftlite-v06-.*-backup-\d+\.sqlite$/i.test(entry.name);
        if (!isCandidate) {
          continue;
        }
        const path = join(directory, entry.name);
        if (seen.has(path) || path === this.dbPath) {
          continue;
        }
        seen.add(path);
        const info = await stat(path).catch(() => null);
        if (info) {
          files.push({ path, mtimeMs: info.mtimeMs });
        }
      }
    }
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  private async restoreLatestUsableDatabaseBackup(context: string): Promise<boolean> {
    if (!this.sql) {
      return false;
    }
    const candidates = await this.listRecoveryBackupCandidates();
    for (const candidate of candidates) {
      let candidateDb: Database | null = null;
      try {
        const bytes = await readFile(candidate.path);
        if (!bytes.length) {
          continue;
        }
        candidateDb = new this.sql.Database(bytes);
        const issue = this.databaseIntegrityIssue(candidateDb);
        if (issue) {
          candidateDb.close();
          candidateDb = null;
          continue;
        }
        await copyFile(candidate.path, this.dbPath);
        this.db?.close();
        this.db = candidateDb;
        candidateDb = null;
        this.settingsCache = null;
        this.migrateSchema();
        await this.migrateLegacyJson().catch(() => undefined);
        await this.getSettings();
        await this.repairDatabaseIfNeeded(`restore-${context}`);
        await this.persist();
        await this.finalizeLegacyJsonMigration().catch(() => undefined);
        await this.createLastKnownGoodBackup(`restored-${context}`, true).catch(() => undefined);
        return true;
      } catch {
        candidateDb?.close();
      }
    }
    return false;
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
      hubs: Object.fromEntries(settings.activeHubs.filter((hub) => hub.sync).map((hub) => [hub.id, "pending"])),
      teams: Object.fromEntries((settings.activeTeams ?? []).filter((team) => team.sync).map((team) => [team.id, "pending"]))
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
    deckSnapshotJson: match.deckSnapshotJson ?? "",
    sync: {
      community: match.sync?.community ?? "disabled",
      hubs: match.sync?.hubs ?? {},
      teams: match.sync?.teams ?? {}
    }
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
    "myChampionCode",
    "opponentChampionCode",
    "myChampionImage",
    "opponentChampionImage",
    "myBattlefield",
    "opponentBattlefield",
    "myBattlefieldCode",
    "opponentBattlefieldCode",
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

function normalizeStoredDeck(deck: SavedDeck): SavedDeck {
  const importedAt = deck.lastImportedAt || new Date().toISOString();
  return {
    id: deck.id || randomUUID(),
    sourceUrl: deck.sourceUrl ?? "",
    sourceKey: deck.sourceKey ?? "",
    title: deck.title?.trim() || "Untitled deck",
    legend: normalizeLegendName(deck.legend),
    snapshotJson: deck.snapshotJson ?? "",
    lastImportedAt: importedAt,
    lastRefreshStatus: deck.lastRefreshStatus || "ok",
    lastRefreshError: deck.lastRefreshError ?? ""
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
