import { app, type BrowserWindow } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { normalizeLegendName } from "../../shared/legendNames.js";
import {
  isGenericAccountDisplayName,
  resolveCompletedAccountLinkUid
} from "../../shared/accountIdentity.js";
import { publicCommunitySyncEnabled } from "../../shared/syncPolicy.js";
import type {
  AccountCloudSyncCounts,
  AccountCloudSyncStatus,
  AccountConnectionStatus,
  AccountLinkSession,
  AccountLinkStatus,
  AccountProfile,
  AccountProfileBackfillResult,
  CommunityMatch,
  HubActionResult,
  HubInboxItem,
  HubInvite,
  HubMember,
  HubMessage,
  LfgListing,
  LfgListingDraft,
  PrivateHub,
  PublicProfileSearchResult,
  MatchDraft,
  RiftLiteBackupFile,
  SocialTeamApplication,
  SocialTeamApplicationDraft,
  SocialTeamDetail,
  SocialTeamDraft,
  SocialTeamMember,
  SocialTeamMessage,
  SocialTeamProfile,
  TeamModerationAction,
  TeamModerationRecord,
  UserSettings
} from "../../shared/types.js";
import { RiftLiteStore } from "./store.js";

const FIREBASE_API_KEY = "AIzaSyBNqEY-i_CggjhDKVltoPQFrSOEfHF7fBA";
const FIREBASE_PROJECT_ID = "riftlite-b61a5";
const COMMUNITY_API_BASE = "https://www.riftlite.com";
const COMMUNITY_API_BASES = ["https://www.riftlite.com", "https://riftlite.com"];
const COMMUNITY_FIRESTORE_FALLBACK_LIMIT = 500;
const TOKEN_FRESH_SECONDS = 300;
const ACCOUNT_CLOUD_SYNC_FORMAT = "riftlite.account-cloud-sync";
const ACCOUNT_CLOUD_SYNC_LEGACY_VERSION = 1;
const ACCOUNT_CLOUD_SYNC_VERSION = 2;
const ACCOUNT_CLOUD_SYNC_CHUNK_SIZE = 450_000;
const ACCOUNT_CLOUD_SYNC_CHECKSUM_ALGORITHM = "sha256";
const ACCOUNT_CLOUD_SYNC_MAX_CHUNKS = 10_000;
const EMPTY_ACCOUNT_CLOUD_COUNTS: AccountCloudSyncCounts = {
  matches: 0,
  decks: 0,
  notebooks: 0,
  replays: 0
};
const GENERIC_DISPLAY_NAMES = new Set([
  "riftlite player",
  "riftlite user",
  "a riftlite player",
  "player",
  "member",
  "owner"
]);
const GENERIC_DECK_NAMES = new Set([
  "riftbound",
  "tcga deck",
  "deck pending",
  "no deck",
  "no deck logged",
  "unknown"
]);

interface AuthState {
  uid: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface AccountCloudSyncManifest {
  version: number;
  updatedAt: string;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  generationId: string;
  chunkCount: number;
  byteSize: number;
  checksumAlgorithm: string;
  checksum: string;
  chunkChecksums: string[];
  counts: AccountCloudSyncCounts;
  updateTime: string;
}

interface FirestorePrecondition {
  exists?: boolean;
  updateTime?: string;
}

type FirestoreRequestOptions =
  | { method: "GET" | "DELETE"; body?: never; precondition?: FirestorePrecondition }
  | { method: "POST" | "PATCH"; body: unknown; precondition?: FirestorePrecondition };

class AccountCloudSyncConflictError extends Error {
  constructor() {
    super("The cloud backup changed on another device while RiftLite was syncing. Nothing was overwritten; check the cloud status and choose Restore or Sync now again.");
    this.name = "AccountCloudSyncConflictError";
  }
}

class LinkedAccountMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkedAccountMismatchError";
  }
}

export class FirebaseSyncService {
  private auth: AuthState | null = null;
  private linkedAccountAuthGeneration = 0;

  constructor(
    private readonly store: RiftLiteStore,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  getLinkedAccountAuthGeneration(): number {
    return this.linkedAccountAuthGeneration;
  }

  isLinkedAccountAuthGenerationCurrent(generation: number): boolean {
    return generation === this.linkedAccountAuthGeneration;
  }

  invalidateLinkedAccountAuth(): void {
    this.linkedAccountAuthGeneration += 1;
    this.auth = null;
  }

  async syncMatch(match: MatchDraft, options: { forceTeamIds?: string[]; quiet?: boolean } = {}): Promise<MatchDraft> {
    const settings = await this.store.getSettings();
    let next: MatchDraft = {
      ...match,
      sync: {
        community: match.sync.community,
        hubs: { ...match.sync.hubs },
        teams: { ...(match.sync.teams ?? {}) }
      }
    };

    if (!isManualSource(next) && publicCommunitySyncEnabled(settings) && next.sync.community !== "disabled") {
      try {
        const doc = await this.uploadPublicMatch(next, settings);
        next = {
          ...next,
          sync: { ...next.sync, community: doc ? "synced" : "failed" }
        };
      } catch {
        next = {
          ...next,
          sync: { ...next.sync, community: "failed" }
        };
      }
    } else if (next.sync.community !== "disabled") {
      next = {
        ...next,
        sync: { ...next.sync, community: "disabled" }
      };
    }

    const activeHubIds = new Set(settings.activeHubs.filter((hub) => hub.sync).map((hub) => hub.id));
    const hubEntries = Object.entries(next.sync.hubs).filter(([hubId]) => activeHubIds.has(hubId));
    for (const [hubId, state] of hubEntries) {
      if (state === "synced") {
        continue;
      }
      try {
        await this.uploadHubMatch(hubId, next, settings);
        next = {
          ...next,
          sync: { ...next.sync, hubs: { ...next.sync.hubs, [hubId]: "synced" } }
        };
      } catch {
        next = {
          ...next,
          sync: { ...next.sync, hubs: { ...next.sync.hubs, [hubId]: "failed" } }
        };
      }
    }

    const activeTeamIds = new Set([
      ...(settings.activeTeams ?? []).filter((team) => team.sync).map((team) => team.id),
      ...(options.forceTeamIds ?? []).filter(Boolean)
    ]);
    const teamEntries = Object.entries(next.sync.teams ?? {}).filter(([teamId]) => activeTeamIds.has(teamId));
    for (const [teamId, state] of teamEntries) {
      if (state === "synced") {
        continue;
      }
      try {
        await this.uploadTeamMatch(teamId, next, settings);
        next = {
          ...next,
          sync: { ...next.sync, teams: { ...(next.sync.teams ?? {}), [teamId]: "synced" } }
        };
      } catch {
        next = {
          ...next,
          sync: { ...next.sync, teams: { ...(next.sync.teams ?? {}), [teamId]: "failed" } }
        };
      }
    }

    if (next.manualRepair && next.combinedFromMatchIds?.length) {
      try {
        await this.markCombinedOriginalsSuperseded(next, settings);
      } catch {
        next = {
          ...next,
          sync: {
            community: next.sync.community === "synced" ? "failed" : next.sync.community,
            hubs: Object.fromEntries(Object.entries(next.sync.hubs).map(([hubId, state]) => [hubId, state === "synced" ? "failed" : state])),
            teams: Object.fromEntries(Object.entries(next.sync.teams ?? {}).map(([teamId, state]) => [teamId, state === "synced" ? "failed" : state]))
          }
        };
      }
    }

    const saved = await this.store.saveMatch(next);
    if (!options.quiet) {
      this.getWindow()?.webContents.send("match:draft", saved);
    }
    return saved;
  }

  async markMatchesSuperseded(localMatchIds: string[], combinedMatchId: string): Promise<void> {
    const settings = await this.store.getSettings();
    await this.markOriginalMatchIdsSuperseded(localMatchIds, combinedMatchId, settings);
  }

  async createHub(name: string, password: string, settings: UserSettings): Promise<HubActionResult> {
    const fallbackHub = buildHub(name, "owner");
    const payload = await this.authenticatedWebsiteRequest("/api/hubs", {
      method: "POST",
      body: {
        action: "create",
        name,
        password
      }
    });
    const hub = normalizePrivateHubPayload(payload.hub, fallbackHub);
    const nextSettings = await this.store.saveSettings({
      activeHubs: upsertHub(settings.activeHubs, hub),
      syncMode: publicCommunitySyncEnabled(settings) ? "community-and-hubs" : "private-hubs-only",
      communitySyncEnabled: publicCommunitySyncEnabled(settings)
    });
    return { hub, settings: nextSettings };
  }

  async joinHub(name: string, password: string, settings: UserSettings): Promise<HubActionResult> {
    const fallbackHub = buildHub(name, "member");
    const payload = await this.authenticatedWebsiteRequest("/api/hubs", {
      method: "POST",
      body: {
        action: "join",
        name,
        password
      }
    });
    const nextHub = normalizePrivateHubPayload(payload.hub, fallbackHub);
    const nextSettings = await this.store.saveSettings({
      activeHubs: upsertHub(settings.activeHubs, nextHub),
      syncMode: publicCommunitySyncEnabled(settings) ? "community-and-hubs" : "private-hubs-only",
      communitySyncEnabled: publicCommunitySyncEnabled(settings)
    });
    return { hub: nextHub, settings: nextSettings };
  }

  async refreshAccountHubs(): Promise<UserSettings> {
    const settings = await this.store.getSettings();
    if (!settings.accountUid) return settings;
    const payload = await this.authenticatedWebsiteRequest("/api/hubs", { method: "GET" });
    const rows = Array.isArray(payload.hubs) ? payload.hubs : [];
    let activeHubs = [...settings.activeHubs];
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const id = readString(row.id);
      const name = readString(row.name) || id;
      if (!id) continue;
      const role = readString(row.role);
      const fallback = buildHub(name, role === "owner" ? "owner" : role === "admin" ? "admin" : "member");
      activeHubs = upsertHub(activeHubs, normalizePrivateHubPayload({ ...row, id }, fallback));
    }
    return this.store.saveSettings({ activeHubs });
  }

  async getCommunityMatches(forceRefresh = false, limit = COMMUNITY_FIRESTORE_FALLBACK_LIMIT): Promise<CommunityMatch[]> {
    const settings = await this.store.getSettings();
    const webMatches = await this.getCommunityMatchesFromWebsite(forceRefresh);
    if (webMatches) {
      return repairCommunityMatchesForSettings(webMatches.filter((match) => !match.superseded), settings);
    }
    const auth = await this.getAuth(settings);
    const response = await this.firestoreRunQuery("", auth.idToken, {
      structuredQuery: {
        from: [{ collectionId: "matches" }],
        orderBy: [{ field: { fieldPath: "created_at" }, direction: "DESCENDING" }],
        limit
      }
    });
    return repairCommunityMatchesForSettings(response.map((doc) => fromFirestoreDoc(doc, "community")).filter((match) => !match.superseded), settings);
  }

  private async getCommunityMatchesFromWebsite(forceRefresh: boolean): Promise<CommunityMatch[] | null> {
    const query = new URLSearchParams({
      source: "desktop",
      limit: "all",
      ...(forceRefresh ? { refresh: "1" } : {})
    });
    const paths = [
      `/api/community/desktop?${query}`,
      `/api/community/desktop`,
      `/api/community/matches?${query}`,
      `/api/community/matches`
    ];
    for (const base of COMMUNITY_API_BASES) {
      for (const path of paths) {
        try {
          const response = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json" } });
          if (response.status === 404) {
            continue;
          }
          if (!response.ok) {
            continue;
          }
          const payload = await response.json() as unknown;
          const items = webCommunityItems(payload);
          return dedupeCommunityMatches(items.filter(isRecord).map((item) => fromWebMatch(item, "community")).filter((match) => !match.superseded));
        } catch {
          // Try the next public API variant, then fall back to capped Firestore.
        }
      }
    }
    return null;
  }

  async getHubMatches(hubId: string, forceRefresh = false, limit = 1000): Promise<CommunityMatch[]> {
    void forceRefresh;
    const settings = await this.store.getSettings();
    const auth = await this.getAuth(settings);
    const response = await this.firestoreRunQuery(`hubs/${encodeURIComponent(hubId)}`, auth.idToken, {
      structuredQuery: {
        from: [{ collectionId: "matches" }],
        orderBy: [{ field: { fieldPath: "created_at" }, direction: "DESCENDING" }],
        limit
      }
    });
    return response.map((doc) => fromFirestoreDoc(doc, "hub", hubId)).filter((match) => !match.superseded);
  }

  async getTeamMatches(teamId: string, forceRefresh = false, limit = 1000): Promise<CommunityMatch[]> {
    const query = new URLSearchParams({
      limit: String(Math.max(1, Math.min(limit, 2000))),
      refresh: forceRefresh ? "1" : "0"
    });
    const payload = await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/matches?${query}`, { method: "GET" });
    return webCommunityItems(payload)
      .filter(isRecord)
      .map((item) => fromWebMatch(item, "team", teamId))
      .filter((match) => !match.superseded);
  }

  async deleteHubMatch(hubId: string, matchId: string): Promise<void> {
    const settings = await this.store.getSettings();
    const auth = await this.getAuth(settings);
    const safeHubId = encodeURIComponent(hubId);
    const safeMatchId = encodeURIComponent(matchId);
    await this.firestoreRequest(`hubs/${safeHubId}/matches/${safeMatchId}`, auth.idToken, { method: "DELETE" });
    await this.updatePrivateHubAggregate("delete", hubId, matchId, auth.idToken, {
      uid: auth.uid
    }).catch(() => undefined);
    const local = (await this.store.getMatches()).find((match) => match.id === matchId);
    if (local?.sync.hubs[hubId]) {
      const hubs = { ...local.sync.hubs };
      delete hubs[hubId];
      await this.store.saveMatch({ ...local, sync: { ...local.sync, hubs } });
    }
  }

  async deleteTeamMatch(teamId: string, matchId: string): Promise<void> {
    await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/matches/${encodeURIComponent(matchId)}`, { method: "DELETE" });
    const local = (await this.store.getMatches()).find((match) => match.id === matchId);
    if (local?.sync.teams?.[teamId]) {
      const teams = { ...(local.sync.teams ?? {}) };
      delete teams[teamId];
      await this.store.saveMatch({ ...local, sync: { ...local.sync, teams } });
    }
  }

  async startAccountLink(): Promise<AccountLinkSession> {
    const settings = await this.store.getSettings();
    const payload = await this.authenticatedWebsiteRequest("/api/auth/link/start", {
      method: "POST",
      body: { expectedUid: settings.accountUid }
    }, true);
    return {
      sessionId: readString(payload.sessionId),
      code: readString(payload.code),
      loginUrl: readString(payload.loginUrl),
      expiresAt: readNumber(payload.expiresAt)
    };
  }

  async getAccountLinkStatus(sessionId: string): Promise<AccountLinkStatus> {
    const query = new URLSearchParams({ sessionId });
    const payload = await this.authenticatedWebsiteRequest(`/api/auth/link/status?${query}`, { method: "GET" });
    const status = readString(payload.status) as AccountLinkStatus["status"];
    const customToken = readString(payload.customToken);
    if (status === "complete" && customToken) {
      let linkedAuth = await this.signInWithCustomToken(customToken);
      if (!linkedAuth.uid && linkedAuth.refreshToken) {
        linkedAuth = await this.refreshToken(linkedAuth.refreshToken);
      }
      const linkedUid = resolveCompletedAccountLinkUid(payload.uid, linkedAuth.uid);
      if (!linkedUid) {
        throw new Error("The website account did not match the account returned to this desktop.");
      }
      this.invalidateLinkedAccountAuth();
      this.auth = linkedAuth;
      const currentSettings = await this.store.getSettings();
      const displayName = bestLocalAccountDisplayName(currentSettings, undefined, readString(payload.displayName));
      const settings = await this.store.saveSettings({
        firebaseUid: linkedAuth.uid,
        firebaseRefreshToken: linkedAuth.refreshToken,
        accountUid: linkedUid,
        accountEmail: readString(payload.email),
        accountDisplayName: displayName,
        accountLastVerifiedAt: "",
        accountLastVerificationError: "Account verification is still in progress."
      });
      await this.getAccountProfile().catch(async () => {
        await this.store.saveSettings({
          accountUid: settings.accountUid || linkedAuth.uid,
          accountEmail: settings.accountEmail,
          accountDisplayName: settings.accountDisplayName
        });
      });
      const connection = await this.getAccountConnectionStatus();
      if (!connection.verified) {
        return {
          status: "error",
          uid: linkedUid,
          email: settings.accountEmail,
          displayName: settings.accountDisplayName,
          message: connection.message || "The account linked, but this device could not verify the website replay library."
        };
      }
    }
    if (status === "complete" && !customToken) {
      const settings = await this.store.getSettings();
      const linkedUid = readString(payload.uid);
      if (!linkedUid || settings.accountUid !== linkedUid || !settings.firebaseRefreshToken) {
        return {
          status: "error",
          uid: linkedUid,
          email: readString(payload.email),
          displayName: readString(payload.displayName),
          message: "The secure link was already consumed before this device finished verification. Start a new account link."
        };
      }
      const connection = await this.getAccountConnectionStatus();
      if (!connection.verified) {
        return {
          status: "error",
          uid: linkedUid,
          email: readString(payload.email),
          displayName: readString(payload.displayName),
          message: connection.message
        };
      }
    }
    return {
      status: status === "complete" || status === "expired" || status === "error" ? status : "pending",
      uid: readString(payload.uid),
      email: readString(payload.email),
      displayName: readString(payload.displayName),
      message: readString(payload.message)
    };
  }

  async getAccountProfile(): Promise<AccountProfile | null> {
    try {
      const payload = await this.authenticatedWebsiteRequest("/api/account/profile", { method: "GET" });
      const settings = await this.store.getSettings();
      const profile = await this.repairGenericAccountProfile(normalizeAccountProfile(payload.profile), settings);
      if (!settings.accountUid || profile.uid !== settings.accountUid) {
        return null;
      }
      await this.store.saveSettings({
        accountUid: profile.uid,
        accountEmail: profile.email || settings.accountEmail,
        accountHandle: profile.handle,
        accountDisplayName: bestLocalAccountDisplayName(settings, profile),
        accountProfilePublic: profile.publicProfile
      });
      return profile;
    } catch {
      return null;
    }
  }

  async getAccountConnectionStatus(): Promise<AccountConnectionStatus> {
    return this.loadAccountConnectionStatus(false);
  }

  async repairAccountConnection(): Promise<AccountConnectionStatus> {
    return this.loadAccountConnectionStatus(true);
  }

  private async loadAccountConnectionStatus(repair: boolean): Promise<AccountConnectionStatus> {
    const settings = await this.store.getSettings();
    const autoUploadEnabled = settings.rawCapture.enabled === true &&
      settings.rawCapture.webReplayAutoUploadEnabled === true;
    const autoUploadAccountMatches = !autoUploadEnabled || Boolean(
      settings.accountUid && settings.rawCapture.webReplayAutoUploadAccountUid === settings.accountUid
    );
    const base: AccountConnectionStatus = {
      connected: Boolean(settings.accountUid && settings.firebaseRefreshToken),
      verified: false,
      uid: settings.accountUid,
      email: settings.accountEmail,
      displayName: settings.accountDisplayName,
      handle: settings.accountHandle,
      profileComplete: false,
      replayLibraryReady: false,
      replayCount: 0,
      replayAutoUploadEnabled: autoUploadEnabled,
      replayAutoUploadAccountMatches: autoUploadAccountMatches,
      migrationState: "ready",
      migrationMessage: "",
      checkedAt: settings.accountLastVerifiedAt,
      message: settings.accountLastVerificationError
    };
    if (!base.connected) {
      return {
        ...base,
        message: settings.accountUid
          ? "Reconnect this device to verify your RiftLite account."
          : "Create or sign in to connect this device."
      };
    }

    try {
      const payload = await this.authenticatedWebsiteRequest("/api/account/connection", {
        method: repair ? "POST" : "GET",
        ...(repair ? { body: {} } : {})
      } as { method: "GET" } | { method: "POST"; body: Record<string, never> });
      const connection = isRecord(payload.connection) ? payload.connection : {};
      const uid = readString(connection.uid);
      const verified = Boolean(uid && uid === settings.accountUid && connection.verified === true);
      if (!verified) {
        throw new Error("The website account does not match the account stored on this device.");
      }
      const checkedAt = readString(connection.checkedAt) || new Date().toISOString();
      const migrationStateValue = readString(connection.migrationState);
      const migrationState: AccountConnectionStatus["migrationState"] = migrationStateValue === "attention"
        ? "attention"
        : migrationStateValue === "pending"
          ? "pending"
          : "ready";
      const next: AccountConnectionStatus = {
        ...base,
        connected: true,
        verified: true,
        uid,
        email: readString(connection.email) || settings.accountEmail,
        displayName: readString(connection.displayName) || settings.accountDisplayName,
        handle: readString(connection.handle) || settings.accountHandle,
        profileComplete: connection.profileComplete === true,
        replayLibraryReady: connection.replayLibraryReady === true,
        replayCount: Math.max(0, Math.trunc(readNumber(connection.replayCount))),
        migrationState,
        migrationMessage: readString(connection.migrationMessage),
        checkedAt,
        message: migrationState === "attention"
          ? readString(connection.migrationMessage) || "Your account is connected, but older records need attention."
          : migrationState === "pending"
            ? readString(connection.migrationMessage) || "Your account is connected while older records finish linking."
            : autoUploadAccountMatches
              ? "Website login, desktop identity, replay library, and replay consent all match."
              : "The account is verified, but replay upload consent belongs to another account."
      };
      await this.store.saveSettings({
        accountEmail: next.email,
        accountHandle: next.handle,
        accountDisplayName: next.displayName,
        accountLastVerifiedAt: checkedAt,
        accountLastVerificationError: ""
      });
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not verify the connected RiftLite account.";
      await this.store.saveSettings({ accountLastVerificationError: message });
      return { ...base, message };
    }
  }

  async saveAccountProfile(patch: Partial<AccountProfile>): Promise<AccountProfile> {
    const currentSettings = await this.store.getSettings();
    const safePatch = { ...patch };
    if (Object.prototype.hasOwnProperty.call(safePatch, "displayName")) {
      safePatch.displayName = bestLocalAccountDisplayName(currentSettings, undefined, readString(safePatch.displayName), readString(safePatch.handle));
    }
    const payload = await this.authenticatedWebsiteRequest("/api/account/profile", {
      method: "PATCH",
      body: safePatch
    });
    const profile = normalizeAccountProfile(payload.profile);
    await this.store.saveSettings({
      accountUid: profile.uid,
      accountEmail: profile.email || currentSettings.accountEmail,
      accountHandle: profile.handle,
      accountDisplayName: bestLocalAccountDisplayName(currentSettings, profile),
      accountProfilePublic: profile.publicProfile,
      username: isGenericDisplayName(profile.displayName) ? currentSettings.username : profile.displayName || currentSettings.username
    });
    return profile;
  }

  async refreshAccountProfileMatches(): Promise<AccountProfileBackfillResult> {
    const payload = await this.authenticatedWebsiteRequest("/api/account/profile/backfill", { method: "POST" });
    const aggregate = isRecord(payload.aggregate) ? payload.aggregate : {};
    return {
      ok: Boolean(payload.ok),
      skipped: Boolean(payload.skipped),
      message: readString(payload.message),
      totalMatches: readNumber(aggregate.totalMatches),
      wins: readNumber(aggregate.wins),
      losses: readNumber(aggregate.losses),
      draws: readNumber(aggregate.draws),
      winRate: readNumber(aggregate.winRate)
    };
  }

  async getAccountExportData(): Promise<Record<string, unknown>> {
    return this.authenticatedWebsiteRequest("/api/account/export", { method: "GET" });
  }

  async getAccountCloudSyncStatus(): Promise<AccountCloudSyncStatus> {
    const settings = await this.store.getSettings();
    if (!settings.accountUid) {
      return {
        enabled: settings.accountCloudSyncEnabled,
        signedIn: false,
        hasRemoteBackup: false,
        lastSyncedAt: settings.accountCloudSyncLastSyncedAt,
        lastRestoredAt: settings.accountCloudSyncLastRestoredAt,
        remoteUpdatedAt: "",
        remoteDeviceName: "",
        remoteAppVersion: "",
        remoteBytes: 0,
        remoteCounts: { ...EMPTY_ACCOUNT_CLOUD_COUNTS },
        message: "Link a RiftLite account to use device sync."
      };
    }
    const auth = await this.getAuth(settings);
    const manifest = await this.readAccountCloudManifest(settings.accountUid, auth.idToken);
    return this.accountCloudStatusFromManifest(settings, manifest);
  }

  async setAccountCloudSyncEnabled(enabled: boolean): Promise<AccountCloudSyncStatus> {
    let settings = await this.ensureAccountCloudDevice(await this.store.getSettings());
    if (!enabled) {
      settings = await this.store.saveSettings({
        accountCloudSyncEnabled: false,
        accountCloudSyncLastError: ""
      });
      return this.accountCloudStatusFromManifest(settings, await this.readAccountCloudManifestIfSignedIn(settings));
    }
    if (!settings.accountUid) {
      throw new Error("Link a RiftLite account before using cloud sync.");
    }
    const auth = await this.getAuth(settings);
    const manifest = await this.readAccountCloudManifest(settings.accountUid, auth.idToken);
    if (manifest) {
      settings = await this.store.saveSettings({
        accountCloudSyncEnabled: false,
        accountCloudSyncLastError: ""
      });
      return this.accountCloudStatusFromManifest(
        settings,
        manifest,
        "An existing cloud backup was found. Account sync is still off so it cannot be overwritten. Choose Restore on this device, or choose Sync now to keep this device's local data."
      );
    }

    settings = await this.store.saveSettings({
      accountCloudSyncEnabled: true,
      accountCloudSyncLastError: ""
    });
    try {
      return await this.uploadAccountCloudGeneration(settings, auth, null, "Account sync enabled.");
    } catch (error) {
      const nextSettings = await this.store.saveSettings({
        accountCloudSyncEnabled: false,
        accountCloudSyncLastError: error instanceof Error ? error.message : "Account cloud sync failed."
      });
      if (error instanceof AccountCloudSyncConflictError) {
        const nextManifest = await this.readAccountCloudManifest(settings.accountUid, auth.idToken);
        return this.accountCloudStatusFromManifest(
          nextSettings,
          nextManifest,
          "A cloud backup appeared while account sync was being enabled. Nothing was overwritten. Choose Restore on this device, or choose Sync now to keep this device's local data."
        );
      }
      throw error;
    }
  }

  async uploadAccountCloudSync(message = "Account data synced."): Promise<AccountCloudSyncStatus> {
    const settings = await this.ensureAccountCloudDevice(await this.store.getSettings());
    if (!settings.accountUid) {
      throw new Error("Link a RiftLite account before using cloud sync.");
    }
    const auth = await this.getAuth(settings);
    const oldManifest = await this.readAccountCloudManifest(settings.accountUid, auth.idToken);
    return this.uploadAccountCloudGeneration(settings, auth, oldManifest, message);
  }

  async restoreAccountCloudSync(): Promise<AccountCloudSyncStatus> {
    const settings = await this.ensureAccountCloudDevice(await this.store.getSettings());
    if (!settings.accountUid) {
      throw new Error("Link a RiftLite account before restoring account data.");
    }
    const auth = await this.getAuth(settings);
    const manifest = await this.readAccountCloudManifest(settings.accountUid, auth.idToken);
    validateAccountCloudManifestForRestore(manifest);

    const safeUid = encodeURIComponent(settings.accountUid);
    const chunks: string[] = [];
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      const doc = await this.firestoreRequest(
        `accountSync/${safeUid}/chunks/${accountCloudChunkDocumentId(manifest.generationId, index)}`,
        auth.idToken,
        { method: "GET" }
      );
      const fields = isRecord(doc.fields) ? doc.fields : {};
      const payload = readFirestoreString(fields.payload);
      const expectedChecksum = manifest.chunkChecksums[index];
      if (Math.trunc(readFirestoreNumber(fields.index)) !== index) {
        throw new Error(`Account cloud backup chunk ${index + 1} has an invalid index.`);
      }
      if (!payload) {
        throw new Error(`Account cloud backup is missing chunk ${index + 1}.`);
      }
      if (manifest.version === ACCOUNT_CLOUD_SYNC_VERSION) {
        if (readFirestoreString(fields.generation_id) !== manifest.generationId) {
          throw new Error(`Account cloud backup chunk ${index + 1} belongs to a different generation.`);
        }
        if (readFirestoreNumber(fields.byte_size) !== Buffer.byteLength(payload, "utf8")) {
          throw new Error(`Account cloud backup chunk ${index + 1} has an invalid size.`);
        }
        if (readFirestoreString(fields.checksum) !== expectedChecksum || sha256(payload) !== expectedChecksum) {
          throw new Error(`Account cloud backup chunk ${index + 1} failed its checksum.`);
        }
      }
      chunks.push(payload);
    }

    const compressed = chunks.join("");
    if (Buffer.byteLength(compressed, "utf8") !== manifest.byteSize) {
      throw new Error("Account cloud backup size does not match its manifest.");
    }
    if (manifest.version === ACCOUNT_CLOUD_SYNC_VERSION && sha256(compressed) !== manifest.checksum) {
      throw new Error("Account cloud backup failed its full checksum.");
    }

    let backup: RiftLiteBackupFile;
    try {
      const json = inflateRawSync(Buffer.from(compressed, "base64")).toString("utf8");
      backup = JSON.parse(json) as RiftLiteBackupFile;
    } catch {
      throw new Error("Account cloud backup could not be decoded safely.");
    }
    if (!isAccountCloudBackupFile(backup)) {
      throw new Error("Account cloud backup is not a supported RiftLite backup.");
    }
    if (!sameAccountCloudCounts(countAccountCloudBackup(backup), manifest.counts)) {
      throw new Error("Account cloud backup contents do not match its manifest.");
    }
    const safeBackup: RiftLiteBackupFile = {
      ...backup,
      settings: {
        ...backup.settings,
        rawCapture: {
          ...backup.settings.rawCapture,
          apiKey: "",
          webReplayAutoUploadEnabled: false,
          webReplayAutoUploadAccountUid: "",
          webReplayDiscordShareEnabled: false,
          webReplayDiscordShareAccountUid: "",
          webReplayDiscordShareHubIds: [],
          uploadEnabled: false,
          visibility: "private"
        }
      }
    };
    await this.store.restoreBackupData(safeBackup, { preserveAccount: true, preserveReplays: true });
    const restoredAt = new Date().toISOString();
    const nextSettings = await this.store.saveSettings({
      accountCloudSyncEnabled: true,
      accountCloudSyncLastRestoredAt: restoredAt,
      accountCloudSyncLastError: ""
    });
    return this.accountCloudStatusFromManifest(nextSettings, manifest, "Account data restored on this device.");
  }

  private async uploadAccountCloudGeneration(
    settings: UserSettings,
    auth: AuthState,
    oldManifest: AccountCloudSyncManifest | null,
    message: string
  ): Promise<AccountCloudSyncStatus> {
    if (oldManifest && !oldManifest.updateTime) {
      throw new Error("RiftLite could not verify the current cloud manifest version, so the existing backup was not overwritten. Check cloud status and try again.");
    }
    const backup = await this.buildAccountCloudBackup(settings);
    const json = JSON.stringify(backup);
    const compressed = deflateRawSync(Buffer.from(json, "utf8")).toString("base64");
    const chunks = chunkString(compressed, ACCOUNT_CLOUD_SYNC_CHUNK_SIZE);
    const updatedAt = new Date().toISOString();
    const generationId = randomUUID();
    const chunkChecksums = chunks.map(sha256);
    const manifest: AccountCloudSyncManifest = {
      version: ACCOUNT_CLOUD_SYNC_VERSION,
      updatedAt,
      deviceId: settings.accountCloudSyncDeviceId,
      deviceName: settings.accountCloudSyncDeviceName,
      appVersion: app.getVersion(),
      generationId,
      chunkCount: chunks.length,
      byteSize: Buffer.byteLength(compressed, "utf8"),
      checksumAlgorithm: ACCOUNT_CLOUD_SYNC_CHECKSUM_ALGORITHM,
      checksum: sha256(compressed),
      chunkChecksums,
      counts: countAccountCloudBackup(backup),
      updateTime: ""
    };

    const safeUid = encodeURIComponent(settings.accountUid);
    try {
      const chunkWrites = await Promise.allSettled(chunks.map((chunk, index) =>
        this.firestoreRequest(
          `accountSync/${safeUid}/chunks/${accountCloudChunkDocumentId(generationId, index)}`,
          auth.idToken,
          {
            method: "PATCH",
            precondition: { exists: false },
            body: {
              fields: toFirestoreFields({
                format: ACCOUNT_CLOUD_SYNC_FORMAT,
                version: ACCOUNT_CLOUD_SYNC_VERSION,
                generation_id: generationId,
                index,
                payload: chunk,
                byte_size: Buffer.byteLength(chunk, "utf8"),
                checksum: chunkChecksums[index],
                created_at: updatedAt
              })
            }
          }
        )
      ));
      const failedChunkWrite = chunkWrites.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failedChunkWrite) {
        throw failedChunkWrite.reason;
      }
      await this.firestoreRequest(`accountSync/${safeUid}/manifest/current`, auth.idToken, {
        method: "PATCH",
        precondition: oldManifest?.updateTime
          ? { updateTime: oldManifest.updateTime }
          : { exists: Boolean(oldManifest) },
        body: {
          fields: toFirestoreFields({
            format: ACCOUNT_CLOUD_SYNC_FORMAT,
            version: ACCOUNT_CLOUD_SYNC_VERSION,
            updated_at: manifest.updatedAt,
            device_id: manifest.deviceId,
            device_name: manifest.deviceName,
            app_version: manifest.appVersion,
            generation_id: manifest.generationId,
            chunk_count: manifest.chunkCount,
            byte_size: manifest.byteSize,
            checksum_algorithm: ACCOUNT_CLOUD_SYNC_CHECKSUM_ALGORITHM,
            checksum: manifest.checksum,
            chunk_checksums: manifest.chunkChecksums,
            counts: manifest.counts
          })
        }
      });
    } catch (error) {
      await this.cleanupAccountCloudGeneration(settings.accountUid, auth.idToken, manifest).catch(() => undefined);
      if (isFirestorePreconditionError(error)) {
        throw new AccountCloudSyncConflictError();
      }
      throw error;
    }

    const nextSettings = await this.store.saveSettings({
      accountCloudSyncEnabled: true,
      accountCloudSyncLastSyncedAt: updatedAt,
      accountCloudSyncLastError: ""
    });
    if (oldManifest) {
      await this.cleanupAccountCloudGeneration(settings.accountUid, auth.idToken, oldManifest).catch(() => undefined);
    }
    return this.accountCloudStatusFromManifest(nextSettings, manifest, message);
  }

  async refreshLinkedAccountIdToken(): Promise<string | null> {
    const settings = await this.store.getSettings();
    if (!settings.accountUid || !settings.firebaseRefreshToken) {
      return null;
    }
    const generation = this.linkedAccountAuthGeneration;
    const auth = await this.refreshToken(settings.firebaseRefreshToken);
    const latestSettings = await this.store.getSettings();
    if (
      !this.isLinkedAccountAuthGenerationCurrent(generation) ||
      latestSettings.accountUid !== settings.accountUid ||
      latestSettings.firebaseRefreshToken !== settings.firebaseRefreshToken ||
      !auth.idToken ||
      auth.uid !== settings.accountUid
    ) {
      throw new Error("The linked RiftLite account changed while creating the replay session.");
    }
    // This path only needs a short-lived ID token for the isolated replay webview.
    // Avoid persisting refreshed credentials here: an account switch could otherwise
    // interleave between the identity check and settings write and restore the old user.
    this.auth = auth;
    return auth.idToken;
  }

  async unlinkAccount(): Promise<UserSettings> {
    this.invalidateLinkedAccountAuth();
    const settings = await this.store.getSettings();
    return this.store.saveSettings({
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
      rawCapture: {
        ...settings.rawCapture,
        enabled: settings.rawCapture.uploadEnabled === true && settings.rawCapture.enabled === true,
        webReplayAutoUploadEnabled: false,
        webReplayAutoUploadAccountUid: "",
        webReplayDiscordShareEnabled: false,
        webReplayDiscordShareAccountUid: "",
        webReplayDiscordShareHubIds: []
      }
    });
  }

  async searchPublicProfiles(query: string): Promise<PublicProfileSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    const response = await fetch(`${COMMUNITY_API_BASE}/api/user/search?${params}`, {
      headers: { "Content-Type": "application/json" }
    });
    if (!response.ok) return [];
    const payload = await response.json() as Record<string, unknown>;
    return Array.isArray(payload.profiles)
      ? payload.profiles.filter(isRecord).map((profile) => ({
        uid: readString(profile.uid),
        handle: readString(profile.handle),
        displayName: readString(profile.displayName)
      }))
      : [];
  }

  async claimHub(hubId: string, password?: string): Promise<void> {
    const settings = await this.store.getSettings();
    const hub = settings.activeHubs.find((item) => item.id === hubId);
    const cleanPassword = String(password ?? "").trim();
    if (!cleanPassword) {
      throw new Error("Enter the hub password to claim ownership.");
    }
    const profile = await this.getAccountProfile().catch(() => null);
    await this.authenticatedWebsiteRequest("/api/hubs/claim", {
      method: "POST",
      body: {
        hubId,
        password: cleanPassword,
        displayName: bestLocalAccountDisplayName(settings, profile)
      }
    });
    if (hub) {
      await this.store.saveSettings({
        activeHubs: settings.activeHubs.map((item) => item.id === hubId ? { ...item, role: "owner", claimed: true } : item)
      });
    }
  }

  private async repairGenericAccountProfile(profile: AccountProfile, settings: UserSettings): Promise<AccountProfile> {
    const preferred = bestLocalAccountDisplayName(settings, profile);
    if (!preferred || !isGenericDisplayName(profile.displayName) || sameName(profile.displayName, preferred)) {
      return profile;
    }
    const payload = await this.authenticatedWebsiteRequest("/api/account/profile", {
      method: "PATCH",
      body: { displayName: preferred }
    });
    return normalizeAccountProfile(payload.profile);
  }

  async getHubInbox(): Promise<HubInboxItem[]> {
    const payload = await this.authenticatedWebsiteRequest("/api/inbox?limit=50", { method: "GET" });
    return Array.isArray(payload.items) ? payload.items.filter(isRecord).map(normalizeHubInboxItem) : [];
  }

  async acceptHubInvite(inviteId: string): Promise<HubActionResult | null> {
    const payload = await this.authenticatedWebsiteRequest("/api/hubs/invites/accept", {
      method: "POST",
      body: { inviteId }
    });
    const rawHub = isRecord(payload.hub) ? payload.hub : {};
    const hubId = readString(rawHub.id) || readString(payload.hubId);
    if (!hubId) {
      return null;
    }
    const settings = await this.store.getSettings();
    const hub: PrivateHub = {
      id: hubId,
      name: readString(rawHub.name) || hubId,
      sync: true,
      role: "member",
      claimed: true,
      joinedAt: new Date().toISOString()
    };
    const nextSettings = await this.store.saveSettings({
      activeHubs: upsertHub(settings.activeHubs, hub),
      syncMode: publicCommunitySyncEnabled(settings) ? "community-and-hubs" : "private-hubs-only",
      communitySyncEnabled: publicCommunitySyncEnabled(settings)
    });
    return { hub, settings: nextSettings };
  }

  async declineHubInvite(inviteId: string): Promise<void> {
    await this.authenticatedWebsiteRequest("/api/hubs/invites/decline", {
      method: "POST",
      body: { inviteId }
    });
  }

  async getHubMembers(hubId: string): Promise<HubMember[]> {
    const payload = await this.authenticatedWebsiteRequest(`/api/hubs/${encodeURIComponent(hubId)}/members`, { method: "GET" });
    return Array.isArray(payload.members) ? payload.members.filter(isRecord).map(normalizeHubMember) : [];
  }

  async createHubInvite(hubId: string, targetHandle = ""): Promise<HubInvite> {
    const payload = await this.authenticatedWebsiteRequest(`/api/hubs/${encodeURIComponent(hubId)}/invites`, {
      method: "POST",
      body: { targetHandle }
    });
    const invite = isRecord(payload.invite) ? payload.invite : {};
    return {
      inviteId: readString(invite.inviteId),
      hubId: readString(invite.hubId) || hubId,
      hubName: readString(invite.hubName),
      targetHandle: readString(invite.targetHandle),
      targetUid: readString(invite.targetUid),
      senderHandle: readString(invite.senderHandle),
      senderDisplayName: readString(invite.senderDisplayName),
      delivered: Boolean(invite.delivered),
      inviteUrl: readString(payload.inviteUrl),
      expiresAt: readNumber(invite.expiresAt)
    };
  }

  async getHubMessages(hubId: string): Promise<HubMessage[]> {
    const payload = await this.authenticatedWebsiteRequest(`/api/hubs/${encodeURIComponent(hubId)}/messages`, { method: "GET" });
    return Array.isArray(payload.messages) ? payload.messages.filter(isRecord).map(normalizeHubMessage) : [];
  }

  async postHubMessage(hubId: string, text: string): Promise<HubMessage> {
    const payload = await this.authenticatedWebsiteRequest(`/api/hubs/${encodeURIComponent(hubId)}/messages`, {
      method: "POST",
      body: { text }
    });
    return normalizeHubMessage(isRecord(payload.message) ? payload.message : {});
  }

  async deleteHubMessage(hubId: string, messageId: string): Promise<void> {
    await this.authenticatedWebsiteRequest(`/api/hubs/${encodeURIComponent(hubId)}/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE"
    });
  }

  async getLfgListings(includeMine = true): Promise<LfgListing[]> {
    const query = new URLSearchParams(includeMine ? { mine: "1" } : {});
    const payload = await this.authenticatedWebsiteRequest(`/api/lfg${query.toString() ? `?${query}` : ""}`, { method: "GET" });
    return Array.isArray(payload.listings) ? payload.listings.filter(isRecord).map(normalizeLfgListing) : [];
  }

  async createLfgListing(draft: LfgListingDraft): Promise<LfgListing> {
    const payload = await this.authenticatedWebsiteRequest("/api/lfg", {
      method: "POST",
      body: draft
    });
    return normalizeLfgListing(isRecord(payload.listing) ? payload.listing : {});
  }

  async acceptLfgListing(listingId: string): Promise<LfgListing> {
    const payload = await this.authenticatedWebsiteRequest(`/api/lfg/${encodeURIComponent(listingId)}/accept`, {
      method: "POST",
      body: {}
    });
    return normalizeLfgListing(isRecord(payload.listing) ? payload.listing : {});
  }

  async closeLfgListing(listingId: string): Promise<LfgListing> {
    const payload = await this.authenticatedWebsiteRequest(`/api/lfg/${encodeURIComponent(listingId)}`, { method: "DELETE" });
    return normalizeLfgListing(isRecord(payload.listing) ? payload.listing : {});
  }

  async createLfgVoice(listingId: string): Promise<LfgListing> {
    const payload = await this.authenticatedWebsiteRequest(`/api/lfg/${encodeURIComponent(listingId)}/voice`, { method: "POST", body: {} });
    return normalizeLfgListing(isRecord(payload.listing) ? payload.listing : {});
  }

  async exchangeDiscordRpcCode(code: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
    const payload = await this.authenticatedWebsiteRequest("/api/discord/rpc-token", {
      method: "POST",
      body: { code }
    });
    const accessToken = readString(payload.accessToken);
    if (!accessToken) {
      throw new Error("Discord did not return a usable voice authorization token.");
    }
    return {
      accessToken,
      refreshToken: readString(payload.refreshToken),
      expiresAt: readNumber(payload.expiresAt) || Date.now() + 15 * 60 * 1000
    };
  }

  async refreshDiscordRpcToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
    const payload = await this.authenticatedWebsiteRequest("/api/discord/rpc-token", {
      method: "POST",
      body: { refreshToken }
    });
    const accessToken = readString(payload.accessToken);
    if (!accessToken) {
      throw new Error("Discord did not return a refreshed voice authorization token.");
    }
    return {
      accessToken,
      refreshToken: readString(payload.refreshToken),
      expiresAt: readNumber(payload.expiresAt) || Date.now() + 15 * 60 * 1000
    };
  }

  async getSocialTeams(options: { mine?: boolean; query?: string } = {}): Promise<SocialTeamProfile[]> {
    const query = new URLSearchParams({
      ...(options.mine ? { mine: "1" } : {}),
      ...(options.query ? { q: options.query } : {})
    });
    const payload = await this.authenticatedWebsiteRequest(`/api/teams${query.toString() ? `?${query}` : ""}`, { method: "GET" });
    return Array.isArray(payload.teams) ? payload.teams.filter(isRecord).map(normalizeSocialTeam) : [];
  }

  async createSocialTeam(draft: SocialTeamDraft): Promise<SocialTeamProfile> {
    const payload = await this.authenticatedWebsiteRequest("/api/teams", {
      method: "POST",
      body: draft
    });
    return normalizeSocialTeam(isRecord(payload.team) ? payload.team : {});
  }

  async getSocialTeam(teamId: string): Promise<SocialTeamDetail> {
    const payload = await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}`, { method: "GET" });
    return {
      team: normalizeSocialTeam(isRecord(payload.team) ? payload.team : {}),
      members: Array.isArray(payload.members) ? payload.members.filter(isRecord).map(normalizeSocialTeamMember) : [],
      myRole: readTeamRole(payload.myRole)
    };
  }

  async updateSocialTeam(teamId: string, patch: SocialTeamDraft): Promise<SocialTeamProfile> {
    const payload = await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}`, {
      method: "PATCH",
      body: patch
    });
    return normalizeSocialTeam(isRecord(payload.team) ? payload.team : {});
  }

  async applyToSocialTeam(teamId: string, draft: SocialTeamApplicationDraft): Promise<SocialTeamApplication> {
    const payload = await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/applications`, {
      method: "POST",
      body: draft
    });
    return normalizeSocialTeamApplication(isRecord(payload.application) ? payload.application : {});
  }

  async getSocialTeamApplications(teamId: string): Promise<SocialTeamApplication[]> {
    const payload = await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/applications`, { method: "GET" });
    return Array.isArray(payload.applications) ? payload.applications.filter(isRecord).map(normalizeSocialTeamApplication) : [];
  }

  async reviewSocialTeamApplication(teamId: string, applicationId: string, status: "accepted" | "declined"): Promise<SocialTeamApplication> {
    const payload = await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/applications/${encodeURIComponent(applicationId)}`, {
      method: "PATCH",
      body: { status }
    });
    return normalizeSocialTeamApplication(isRecord(payload.application) ? payload.application : {});
  }

  async getSocialTeamMessages(teamId: string): Promise<SocialTeamMessage[]> {
    const payload = await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/messages`, { method: "GET" });
    return Array.isArray(payload.messages) ? payload.messages.filter(isRecord).map(normalizeSocialTeamMessage) : [];
  }

  async postSocialTeamMessage(teamId: string, text: string): Promise<SocialTeamMessage> {
    const payload = await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/messages`, {
      method: "POST",
      body: { text }
    });
    return normalizeSocialTeamMessage(isRecord(payload.message) ? payload.message : {});
  }

  async deleteSocialTeamMessage(teamId: string, messageId: string): Promise<void> {
    await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
  }

  async updateSocialTeamMember(teamId: string, uid: string, role: "admin" | "member"): Promise<void> {
    await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(uid)}`, {
      method: "PATCH",
      body: { role }
    });
  }

  async removeSocialTeamMember(teamId: string, uid: string): Promise<void> {
    await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(uid)}`, { method: "DELETE" });
  }

  async reportSocialTeam(payload: { teamId: string; targetType: "team" | "message"; targetId: string; reason: string }): Promise<void> {
    await this.authenticatedWebsiteRequest("/api/teams/report", {
      method: "POST",
      body: payload
    });
  }

  async getModerationTeams(query = ""): Promise<{ isModerator: boolean; teams: TeamModerationRecord[] }> {
    const params = new URLSearchParams({
      ...(query ? { q: query } : {})
    });
    const payload = await this.authenticatedWebsiteRequest(`/api/moderation/teams${params.toString() ? `?${params}` : ""}`, { method: "GET" });
    return {
      isModerator: Boolean(payload.isModerator),
      teams: Array.isArray(payload.teams) ? payload.teams.filter(isRecord).map(normalizeTeamModerationRecord) : []
    };
  }

  async moderateTeam(teamId: string, action: TeamModerationAction, reason = ""): Promise<TeamModerationRecord> {
    const payload = await this.authenticatedWebsiteRequest(`/api/moderation/teams/${encodeURIComponent(teamId)}`, {
      method: "PATCH",
      body: { action, reason }
    });
    return normalizeTeamModerationRecord(isRecord(payload.team) ? payload.team : {});
  }

  private async uploadPublicMatch(match: MatchDraft, settings: UserSettings): Promise<string> {
    const auth = await this.getAuth(settings);
    const doc = buildSyncDoc(match, settings, auth.uid, { includeFlags: false });
    const existingDocId = await this.findPublicMatchDocId(match.id, auth.idToken, auth.uid);
    const response = existingDocId
      ? await this.firestoreRequest(`matches/${encodeURIComponent(existingDocId)}`, auth.idToken, {
        method: "PATCH",
        body: { fields: toFirestoreFields(doc) }
      })
      : await this.firestoreRequest("matches", auth.idToken, {
        method: "POST",
        body: { fields: toFirestoreFields(doc) }
      });
    const name = typeof response.name === "string" ? response.name : "";
    const docId = existingDocId || name.split("/").pop() || "";
    if (docId) {
      await this.appendCommunityAggregate(docId, doc, auth.idToken).catch(() => undefined);
    }
    return docId;
  }

  private async findPublicMatchDocId(localMatchId: string, idToken: string, uid: string): Promise<string> {
    if (!localMatchId) return "";
    const docs = await this.firestoreRunQuery("", idToken, {
      structuredQuery: {
        from: [{ collectionId: "matches" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "local_match_id" },
            op: "EQUAL",
            value: { stringValue: localMatchId }
          }
        },
        limit: 5
      }
    }).catch(() => []);

    for (const doc of docs) {
      const fields = isRecord(doc.fields) ? doc.fields : {};
      if (readFirestoreString(fields.uid) !== uid) continue;
      const name = readString(doc.name);
      const id = name.split("/").pop() ?? "";
      if (id) return id;
    }
    return "";
  }

  private async uploadHubMatch(hubId: string, match: MatchDraft, settings: UserSettings): Promise<string> {
    const auth = await this.getAuth(settings);
    const doc = buildSyncDoc(match, settings, auth.uid, { includeFlags: true });
    const safeHubId = encodeURIComponent(hubId);
    const safeMatchId = encodeURIComponent(match.id);
    const response = await this.firestoreRequest(`hubs/${safeHubId}/matches/${safeMatchId}`, auth.idToken, {
      method: "PATCH",
      body: { fields: toFirestoreFields(doc) }
    });
    await this.updatePrivateHubAggregate("upsert", hubId, match.id, auth.idToken, {
      uid: auth.uid,
      username: readString(doc.username)
    }).catch(() => undefined);
    const name = typeof response.name === "string" ? response.name : "";
    return name.split("/").pop() ?? "";
  }

  private async uploadTeamMatch(teamId: string, match: MatchDraft, settings: UserSettings): Promise<string> {
    const auth = await this.getAuth(settings);
    const doc = buildSyncDoc(match, settings, auth.uid, { includeFlags: true });
    const payload = await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/matches/${encodeURIComponent(match.id)}`, {
      method: "PATCH",
      body: { match: doc }
    });
    const matchPayload = isRecord(payload.match) ? payload.match : {};
    return readString(matchPayload.id) || match.id;
  }

  private async markCombinedOriginalsSuperseded(match: MatchDraft, settings: UserSettings): Promise<void> {
    await this.markOriginalMatchIdsSuperseded(match.combinedFromMatchIds ?? [], match.id, settings);
  }

  private async markOriginalMatchIdsSuperseded(localMatchIds: string[], combinedMatchId: string, settings: UserSettings): Promise<void> {
    const ids = Array.from(new Set(localMatchIds.filter(Boolean)));
    if (!ids.length || !combinedMatchId) {
      return;
    }
    const auth = await this.getAuth(settings);
    const originals = (await this.store.getMatches()).filter((match) => ids.includes(match.id));
    const now = new Date().toISOString();
    for (const original of originals) {
      const superseded: MatchDraft = {
        ...original,
        mergedIntoMatchId: original.mergedIntoMatchId || combinedMatchId,
        hiddenFromStats: true,
        hiddenFromHistory: true,
        updatedAt: now
      };
      const doc = buildSyncDoc(superseded, settings, auth.uid, { includeFlags: true });
      if (original.sync.community === "synced") {
        const publicDocId = await this.findPublicMatchDocId(original.id, auth.idToken, auth.uid);
        if (publicDocId) {
          await this.firestoreRequest(`matches/${encodeURIComponent(publicDocId)}`, auth.idToken, {
            method: "PATCH",
            body: { fields: toFirestoreFields(doc) }
          });
          await this.appendCommunityAggregate(publicDocId, doc, auth.idToken).catch(() => undefined);
        }
      }
      for (const [hubId, state] of Object.entries(original.sync.hubs ?? {})) {
        if (state !== "synced") {
          continue;
        }
        await this.firestoreRequest(`hubs/${encodeURIComponent(hubId)}/matches/${encodeURIComponent(original.id)}`, auth.idToken, {
          method: "PATCH",
          body: { fields: toFirestoreFields(doc) }
        });
      }
      for (const [teamId, state] of Object.entries(original.sync.teams ?? {})) {
        if (state !== "synced") {
          continue;
        }
        await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/matches/${encodeURIComponent(original.id)}`, {
          method: "PATCH",
          body: { match: doc }
        });
      }
    }
  }

  private async ensureAccountCloudDevice(settings: UserSettings): Promise<UserSettings> {
    const patch: Partial<UserSettings> = {};
    if (!settings.accountCloudSyncDeviceId) {
      patch.accountCloudSyncDeviceId = randomUUID();
    }
    if (!settings.accountCloudSyncDeviceName) {
      patch.accountCloudSyncDeviceName = hostname() || "RiftLite device";
    }
    return Object.keys(patch).length ? this.store.saveSettings(patch) : settings;
  }

  private async buildAccountCloudBackup(settings: UserSettings): Promise<RiftLiteBackupFile> {
    const backup = await this.store.exportBackupData({ includeRecycleBin: false });
    const safeSettings: UserSettings = {
      ...backup.settings,
      firebaseUid: "",
      firebaseRefreshToken: "",
      scorepadDeviceSecret: "",
      screenshotDirectory: "",
      replayDirectory: "",
      rawCapture: {
        ...backup.settings.rawCapture,
        apiKey: "",
        webReplayAutoUploadEnabled: false,
        webReplayAutoUploadAccountUid: "",
        webReplayDiscordShareEnabled: false,
        webReplayDiscordShareAccountUid: "",
        webReplayDiscordShareHubIds: [],
        uploadEnabled: false,
        visibility: "private"
      },
      accountCloudSyncEnabled: true,
      accountCloudSyncLastSyncedAt: new Date().toISOString(),
      accountCloudSyncLastRestoredAt: "",
      accountCloudSyncDeviceId: settings.accountCloudSyncDeviceId,
      accountCloudSyncDeviceName: settings.accountCloudSyncDeviceName,
      accountCloudSyncLastError: ""
    };
    return {
      ...backup,
      settings: safeSettings,
      replays: [],
      deletedReplays: []
    };
  }

  private async readAccountCloudManifestIfSignedIn(settings: UserSettings): Promise<AccountCloudSyncManifest | null> {
    if (!settings.accountUid) {
      return null;
    }
    const auth = await this.getAuth(settings);
    return this.readAccountCloudManifest(settings.accountUid, auth.idToken);
  }

  private async cleanupAccountCloudGeneration(uid: string, idToken: string, manifest: AccountCloudSyncManifest): Promise<void> {
    if (manifest.chunkCount < 1 || manifest.chunkCount > ACCOUNT_CLOUD_SYNC_MAX_CHUNKS) {
      return;
    }
    let current: AccountCloudSyncManifest | null;
    try {
      current = await this.readAccountCloudManifest(uid, idToken);
    } catch {
      return;
    }
    if (sameAccountCloudGeneration(current, manifest)) {
      return;
    }

    const safeUid = encodeURIComponent(uid);
    await Promise.allSettled(Array.from({ length: manifest.chunkCount }, (_, index) =>
      this.firestoreRequest(
        `accountSync/${safeUid}/chunks/${accountCloudChunkDocumentId(manifest.generationId, index)}`,
        idToken,
        { method: "DELETE" }
      )
    ));
  }

  private async readAccountCloudManifest(uid: string, idToken: string): Promise<AccountCloudSyncManifest | null> {
    try {
      const doc = await this.firestoreRequest(`accountSync/${encodeURIComponent(uid)}/manifest/current`, idToken, { method: "GET" });
      const fields = isRecord(doc.fields) ? doc.fields : {};
      const format = readFirestoreString(fields.format);
      if (format !== ACCOUNT_CLOUD_SYNC_FORMAT) {
        throw new Error("The account cloud backup manifest has an unrecognized format.");
      }
      const version = readFirestoreNumber(fields.version);
      return {
        version,
        updatedAt: readFirestoreString(fields.updated_at),
        deviceId: readFirestoreString(fields.device_id),
        deviceName: readFirestoreString(fields.device_name),
        appVersion: readFirestoreString(fields.app_version),
        generationId: readFirestoreString(fields.generation_id),
        chunkCount: Math.max(0, Math.trunc(readFirestoreNumber(fields.chunk_count))),
        byteSize: Math.max(0, Math.trunc(readFirestoreNumber(fields.byte_size))),
        checksumAlgorithm: readFirestoreString(fields.checksum_algorithm),
        checksum: readFirestoreString(fields.checksum),
        chunkChecksums: readFirestoreStringArray(fields.chunk_checksums),
        counts: readAccountCloudCounts(fields.counts),
        updateTime: readString(doc.updateTime)
      };
    } catch (error) {
      if (error instanceof Error && /Firestore 404/.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  private accountCloudStatusFromManifest(settings: UserSettings, manifest: AccountCloudSyncManifest | null, message = ""): AccountCloudSyncStatus {
    const defaultMessage = !manifest
      ? "No account cloud backup yet."
      : manifest.version === ACCOUNT_CLOUD_SYNC_VERSION
        ? "Account cloud backup found."
        : manifest.version === ACCOUNT_CLOUD_SYNC_LEGACY_VERSION
          ? "An older cloud backup was found. It can be restored, and the next Sync now will upgrade it to integrity-checked storage."
          : "This cloud backup was created by an unsupported RiftLite version.";
    return {
      enabled: settings.accountCloudSyncEnabled,
      signedIn: Boolean(settings.accountUid),
      hasRemoteBackup: Boolean(manifest),
      lastSyncedAt: settings.accountCloudSyncLastSyncedAt,
      lastRestoredAt: settings.accountCloudSyncLastRestoredAt,
      remoteUpdatedAt: manifest?.updatedAt ?? "",
      remoteDeviceName: manifest?.deviceName ?? "",
      remoteAppVersion: manifest?.appVersion ?? "",
      remoteBytes: manifest?.byteSize ?? 0,
      remoteCounts: manifest?.counts ?? { ...EMPTY_ACCOUNT_CLOUD_COUNTS },
      message: message || defaultMessage
    };
  }

  private async getAuth(settings: UserSettings, allowAccountReconnect = false): Promise<AuthState> {
    const now = Math.floor(Date.now() / 1000);
    if (this.auth && this.auth.expiresAt - TOKEN_FRESH_SECONDS > now) {
      if (settings.accountUid && this.auth.uid !== settings.accountUid && !allowAccountReconnect) {
        throw new LinkedAccountMismatchError("Your RiftLite account needs to be reconnected on this device.");
      }
      return this.auth;
    }
    if (settings.firebaseRefreshToken) {
      try {
        const refreshed = await this.refreshToken(settings.firebaseRefreshToken);
        if (settings.accountUid && refreshed.uid !== settings.accountUid && !allowAccountReconnect) {
          throw new LinkedAccountMismatchError("The saved sign-in belongs to a different RiftLite account.");
        }
        this.auth = refreshed;
        await this.store.saveSettings({
          firebaseUid: this.auth.uid,
          firebaseRefreshToken: this.auth.refreshToken
        });
        return this.auth;
      } catch (error) {
        this.auth = null;
        if (error instanceof LinkedAccountMismatchError) {
          throw error;
        }
        if (settings.accountUid && !allowAccountReconnect) {
          throw new Error("Your RiftLite account session expired. Reconnect it from the Account page.", { cause: error });
        }
      }
    }
    if (settings.accountUid && !allowAccountReconnect) {
      throw new Error("Your RiftLite account needs to be reconnected on this device.");
    }
    this.auth = await this.signInAnonymously();
    await this.store.saveSettings({
      firebaseUid: this.auth.uid,
      firebaseRefreshToken: this.auth.refreshToken
    });
    return this.auth;
  }

  private async signInAnonymously(): Promise<AuthState> {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnSecureToken: true })
      }
    );
    if (!response.ok) {
      throw new Error(`Firebase auth failed: ${response.status}`);
    }
    const payload = await response.json() as Record<string, string>;
    return {
      uid: payload.localId ?? "",
      idToken: payload.idToken ?? "",
      refreshToken: payload.refreshToken ?? "",
      expiresAt: Math.floor(Date.now() / 1000) + Number.parseInt(payload.expiresIn ?? "3600", 10)
    };
  }

  private async refreshToken(refreshToken: string): Promise<AuthState> {
    const response = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
      }
    );
    if (!response.ok) {
      throw new Error(`Firebase token refresh failed: ${response.status}`);
    }
    const payload = await response.json() as Record<string, string>;
    return {
      uid: payload.user_id ?? "",
      idToken: payload.id_token ?? "",
      refreshToken: payload.refresh_token ?? "",
      expiresAt: Math.floor(Date.now() / 1000) + Number.parseInt(payload.expires_in ?? "3600", 10)
    };
  }

  private async signInWithCustomToken(customToken: string): Promise<AuthState> {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true })
      }
    );
    if (!response.ok) {
      throw new Error(`Firebase custom token sign-in failed: ${response.status}`);
    }
    const payload = await response.json() as Record<string, string>;
    return {
      uid: payload.localId ?? "",
      idToken: payload.idToken ?? "",
      refreshToken: payload.refreshToken ?? "",
      expiresAt: Math.floor(Date.now() / 1000) + Number.parseInt(payload.expiresIn ?? "3600", 10)
    };
  }

  private async authenticatedWebsiteRequest(
    path: string,
    options: { method: "GET" | "DELETE"; body?: never } | { method: "POST" | "PATCH"; body?: unknown },
    allowAccountReconnect = false
  ): Promise<Record<string, unknown>> {
    const settings = await this.store.getSettings();
    const auth = await this.getAuth(settings, allowAccountReconnect);
    const response = await fetch(`${COMMUNITY_API_BASE}${path}`, {
      method: options.method,
      headers: {
        "Authorization": `Bearer ${auth.idToken}`,
        "Content-Type": "application/json"
      },
      body: options.method === "GET" || options.method === "DELETE" ? undefined : JSON.stringify(options.body ?? {})
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      if (response.status === 404 && isSocialHubApiPath(path)) {
        throw new Error("Social Hub is not available on the live RiftLite website yet. Please try again after the website update has finished deploying.");
      }
      const preview = text.replace(/\s+/g, " ").slice(0, 120);
      throw new Error(`RiftLite website returned ${response.status} ${response.statusText || "non-JSON response"} for ${path}${preview ? `: ${preview}` : ""}`);
    }
    if (!response.ok) {
      if (response.status === 404 && isSocialHubApiPath(path)) {
        throw new Error("Social Hub is not available on the live RiftLite website yet. Please try again after the website update has finished deploying.");
      }
      throw new Error(readString(payload.error) || `RiftLite API ${response.status}`);
    }
    return payload;
  }

  private async firestoreRequest(path: string, idToken: string, options: FirestoreRequestOptions): Promise<Record<string, unknown>> {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`);
    if (typeof options.precondition?.exists === "boolean") {
      url.searchParams.set("currentDocument.exists", String(options.precondition.exists));
    }
    if (options.precondition?.updateTime) {
      url.searchParams.set("currentDocument.updateTime", options.precondition.updateTime);
    }
    const response = await fetch(url, {
      method: options.method,
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: options.method === "GET" || options.method === "DELETE" ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) {
      const details = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
      throw new Error(`Firestore ${response.status}${details ? `: ${details}` : ""}`);
    }
    if (response.status === 204) {
      return {};
    }
    const text = await response.text();
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  }

  private async firestoreRunQuery(path: string, idToken: string, structuredQuery: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    const suffix = path ? `/${path}:runQuery` : ":runQuery";
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents${suffix}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(structuredQuery)
    });
    if (!response.ok) {
      throw new Error(`Firestore query ${response.status}`);
    }
    const payload = await response.json() as Array<Record<string, unknown>>;
    return payload.map((item) => item.document).filter(isRecord);
  }

  private async appendCommunityAggregate(docId: string, match: Record<string, unknown>, idToken: string): Promise<void> {
    const response = await fetch(`${COMMUNITY_API_BASE}/api/community/aggregate/append`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: docId, match })
    });
    if (!response.ok) {
      throw new Error(`Community append ${response.status}`);
    }
  }

  private async updatePrivateHubAggregate(
    action: "upsert" | "delete",
    hubId: string,
    matchId: string,
    idToken: string,
    details: { uid?: string; username?: string } = {}
  ): Promise<void> {
    const response = await fetch(`${COMMUNITY_API_BASE}/api/community/aggregate/private-hub`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action,
        hubId,
        matchId,
        uid: details.uid,
        username: details.username
      })
    });
    if (!response.ok) {
      throw new Error(`Private hub aggregate ${response.status}`);
    }
  }
}

function buildHub(name: string, role: PrivateHub["role"]): PrivateHub {
  const cleanName = name.trim();
  const id = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
  return {
    id,
    name: cleanName,
    sync: true,
    role,
    joinedAt: new Date().toISOString()
  };
}

function normalizePrivateHubPayload(value: unknown, fallback: PrivateHub): PrivateHub {
  const raw = isRecord(value) ? value : {};
  const role = readString(raw.role);
  const hubRole: PrivateHub["role"] = role === "owner" || role === "admin" || role === "member" ? role : fallback.role;
  return {
    id: readString(raw.id) || fallback.id,
    name: readString(raw.name) || fallback.name,
    sync: typeof raw.sync === "boolean" ? raw.sync : fallback.sync,
    joinedAt: readString(raw.joinedAt) || fallback.joinedAt || new Date().toISOString(),
    role: hubRole,
    claimed: Boolean(raw.claimed),
    imageDataUrl: readString(raw.imageDataUrl) || fallback.imageDataUrl,
    imageUpdatedAt: readString(raw.imageUpdatedAt) || fallback.imageUpdatedAt
  };
}

function upsertHub(hubs: PrivateHub[], hub: PrivateHub): PrivateHub[] {
  return [hub, ...hubs.filter((item) => item.id !== hub.id)];
}

function readFirestoreString(value: unknown): string {
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    return typeof raw.stringValue === "string" ? raw.stringValue : "";
  }
  return "";
}

function readFirestoreMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const raw = value as Record<string, unknown>;
  const mapValue = isRecord(raw.mapValue) ? raw.mapValue : {};
  return isRecord(mapValue.fields) ? mapValue.fields : {};
}

function readAccountCloudCounts(value: unknown): AccountCloudSyncCounts {
  const fields = readFirestoreMap(value);
  return {
    matches: Math.max(0, Math.trunc(readFirestoreNumber(fields.matches))),
    decks: Math.max(0, Math.trunc(readFirestoreNumber(fields.decks))),
    notebooks: Math.max(0, Math.trunc(readFirestoreNumber(fields.notebooks))),
    replays: Math.max(0, Math.trunc(readFirestoreNumber(fields.replays)))
  };
}

function countAccountCloudBackup(backup: RiftLiteBackupFile): AccountCloudSyncCounts {
  return {
    matches: backup.matches.length + backup.deletedMatches.length,
    decks: backup.decks.length,
    notebooks: backup.notebooks.length,
    replays: 0
  };
}

function chunkString(value: string, size: number): string[] {
  if (!value) {
    return [""];
  }
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

function sha256(value: string): string {
  return createHash(ACCOUNT_CLOUD_SYNC_CHECKSUM_ALGORITHM).update(value, "utf8").digest("hex");
}

function accountCloudChunkDocumentId(generationId: string, index: number): string {
  const suffix = `chunk-${String(index).padStart(4, "0")}`;
  if (!generationId) {
    return suffix;
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(generationId)) {
    throw new Error("Account cloud backup generation ID is invalid.");
  }
  return `${generationId}-${suffix}`;
}

function validateAccountCloudManifestForRestore(
  manifest: AccountCloudSyncManifest | null
): asserts manifest is AccountCloudSyncManifest {
  if (!manifest) {
    throw new Error("No account cloud backup was found for this RiftLite account.");
  }
  if (manifest.version !== ACCOUNT_CLOUD_SYNC_LEGACY_VERSION && manifest.version !== ACCOUNT_CLOUD_SYNC_VERSION) {
    throw new Error("This account cloud backup version is not supported by this RiftLite version.");
  }
  if (manifest.chunkCount < 1 || manifest.chunkCount > ACCOUNT_CLOUD_SYNC_MAX_CHUNKS) {
    throw new Error("Account cloud backup chunk count is invalid.");
  }
  if (manifest.byteSize < 1 || manifest.byteSize > ACCOUNT_CLOUD_SYNC_CHUNK_SIZE * manifest.chunkCount) {
    throw new Error("Account cloud backup byte size is invalid.");
  }
  if (manifest.version === ACCOUNT_CLOUD_SYNC_LEGACY_VERSION) {
    return;
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(manifest.generationId)) {
    throw new Error("Account cloud backup generation ID is invalid.");
  }
  if (manifest.checksumAlgorithm !== ACCOUNT_CLOUD_SYNC_CHECKSUM_ALGORITHM) {
    throw new Error("Account cloud backup checksum algorithm is not supported.");
  }
  if (!isSha256(manifest.checksum)) {
    throw new Error("Account cloud backup checksum is invalid.");
  }
  if (manifest.chunkChecksums.length !== manifest.chunkCount || !manifest.chunkChecksums.every(isSha256)) {
    throw new Error("Account cloud backup chunk checksums do not match its manifest.");
  }
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function sameAccountCloudGeneration(left: AccountCloudSyncManifest | null, right: AccountCloudSyncManifest): boolean {
  if (!left) {
    return false;
  }
  if (right.generationId) {
    return left.generationId === right.generationId;
  }
  return !left.generationId && left.version === right.version;
}

function sameAccountCloudCounts(left: AccountCloudSyncCounts, right: AccountCloudSyncCounts): boolean {
  return left.matches === right.matches
    && left.decks === right.decks
    && left.notebooks === right.notebooks
    && left.replays === right.replays;
}

function isAccountCloudBackupFile(value: unknown): value is RiftLiteBackupFile {
  if (!isRecord(value) || value.format !== "riftlite.backup" || value.version !== 1 || !isRecord(value.settings)) {
    return false;
  }
  return Array.isArray(value.matches)
    && Array.isArray(value.deletedMatches)
    && Array.isArray(value.decks)
    && Array.isArray(value.notebooks)
    && Array.isArray(value.replays)
    && Array.isArray(value.deletedReplays);
}

function isFirestorePreconditionError(error: unknown): boolean {
  return error instanceof Error
    && (/Firestore (?:409|412)\b/.test(error.message)
      || /Firestore 400\b.*FAILED_PRECONDITION/i.test(error.message));
}

function fromWebMatch(match: Record<string, unknown>, scope: CommunityMatch["scope"], hubId?: string): CommunityMatch {
  const games = readString(match.games_json) || (Array.isArray(match.games) ? JSON.stringify(match.games) : "");
  const snapshot = readString(match.my_deck_snapshot_json) || (match.deckSnapshot ? JSON.stringify(match.deckSnapshot) : "");
  const uid = readString(match.uid) || readString(match.owner_uid) || readString(match.ownerUid);
  const deckSourceUrl = sanitizeDeckSourceUrl(readString(match.my_deck_source_url) || readString(match.deckSourceUrl));
  const deckSourceKey = sanitizeDeckSourceKey(readString(match.my_deck_source_key) || readString(match.deckSourceKey));
  return {
    id: readString(match.id),
    uid,
    username: resolveCommunityUsername(match, uid),
    date: readString(match.date),
    result: readString(match.result),
    myChampion: normalizeLegendName(readString(match.my_champion) || readString(match.myChampion)),
    opponentChampion: normalizeLegendName(readString(match.opp_champion) || readString(match.oppChampion)),
    opponentName: readString(match.opp_name) || readString(match.oppName),
    format: readFormat(match.fmt ?? match.format),
    score: readString(match.score),
    wentFirst: readString(match.went_first) || readString(match.wentFirst),
    myBattlefield: readString(match.my_battlefield) || readString(match.myBattlefield),
    opponentBattlefield: readString(match.opp_battlefield) || readString(match.oppBattlefield),
    flags: readString(match.flags),
    gamesJson: games,
    deckName: sanitizeDeckName(readString(match.my_deck_name) || readString(match.deckName)),
    deckSourceUrl,
    deckSourceKey,
    deckSnapshotJson: snapshot,
    createdAt: readNumber(match.created_at ?? match.createdAt),
    manualRepair: readBoolean(match.manual_repair ?? match.manualRepair),
    combinedFromMatchIds: readStringArray(match.combined_from_match_ids ?? match.combinedFromMatchIds),
    mergedIntoMatchId: readString(match.merged_into_match_id) || readString(match.mergedIntoMatchId),
    superseded: readBoolean(match.superseded),
    supersededAt: readString(match.superseded_at) || readString(match.supersededAt),
    scope,
    hubId
  };
}

function webCommunityItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const body = isRecord(payload) ? payload : {};
  if (Array.isArray(body.items)) {
    return body.items;
  }
  if (Array.isArray(body.matches)) {
    return body.matches;
  }
  if (Array.isArray(body.data)) {
    return body.data;
  }
  return [];
}

function dedupeCommunityMatches(matches: CommunityMatch[]): CommunityMatch[] {
  const seen = new Set<string>();
  const unique: CommunityMatch[] = [];
  for (const match of matches) {
    const key = match.id || [
      match.uid,
      match.username,
      match.date,
      match.myChampion,
      match.opponentChampion,
      match.opponentName,
      match.score,
      match.scope,
      match.hubId ?? ""
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(match);
  }
  return unique.sort((a, b) => communityMatchTime(b) - communityMatchTime(a));
}

function repairCommunityMatchesForSettings(matches: CommunityMatch[], settings: UserSettings): CommunityMatch[] {
  const knownUids = new Set([settings.accountUid, settings.firebaseUid].map(readString).filter(Boolean));
  const localName = bestLocalAccountDisplayName(settings, undefined, settings.username, settings.accountHandle);
  if (!knownUids.size || !localName) {
    return matches;
  }
  return matches.map((match) => {
    if (!knownUids.has(match.uid) || !isPlaceholderCommunityName(match.username)) {
      return match;
    }
    return { ...match, username: localName };
  });
}

function isPlaceholderCommunityName(value: unknown): boolean {
  const cleaned = readString(value).toLowerCase().replace(/\s+/g, " ");
  return isGenericDisplayName(cleaned) || /^player(?:[ #_-]|$)/i.test(cleaned);
}

function communityMatchTime(match: CommunityMatch): number {
  const dateTime = new Date(match.date).getTime();
  if (!Number.isNaN(dateTime)) {
    return dateTime;
  }
  return match.createdAt ? match.createdAt * 1000 : 0;
}

function fromFirestoreDoc(doc: Record<string, unknown>, scope: CommunityMatch["scope"], hubId?: string): CommunityMatch {
  const fields = isRecord(doc.fields) ? doc.fields : {};
  const name = readString(doc.name);
  const uid = readFirestoreString(fields.uid) || readFirestoreString(fields.owner_uid);
  const deckSourceUrl = sanitizeDeckSourceUrl(readFirestoreString(fields.my_deck_source_url));
  const deckSourceKey = sanitizeDeckSourceKey(readFirestoreString(fields.my_deck_source_key));
  return {
    id: name.split("/").pop() ?? "",
    uid,
    username: bestDisplayNameCandidate(
      readFirestoreString(fields.username),
      readFirestoreString(fields.owner_display_name),
      readFirestoreString(fields.owner_handle),
      fallbackAccountName(uid)
    ),
    date: readFirestoreString(fields.date),
    result: readFirestoreString(fields.result),
    myChampion: normalizeLegendName(readFirestoreString(fields.my_champion)),
    opponentChampion: normalizeLegendName(readFirestoreString(fields.opp_champion)),
    opponentName: readFirestoreString(fields.opp_name),
    format: readFormat(readFirestoreString(fields.fmt)),
    score: readFirestoreString(fields.score),
    wentFirst: readFirestoreString(fields.went_first),
    myBattlefield: readFirestoreString(fields.my_battlefield),
    opponentBattlefield: readFirestoreString(fields.opp_battlefield),
    flags: readFirestoreString(fields.flags),
    gamesJson: readFirestoreString(fields.games_json),
    deckName: sanitizeDeckName(readFirestoreString(fields.my_deck_name)),
    deckSourceUrl,
    deckSourceKey,
    deckSnapshotJson: readFirestoreString(fields.my_deck_snapshot_json),
    createdAt: readFirestoreNumber(fields.created_at),
    manualRepair: readFirestoreBool(fields.manual_repair),
    combinedFromMatchIds: readFirestoreStringArray(fields.combined_from_match_ids),
    mergedIntoMatchId: readFirestoreString(fields.merged_into_match_id),
    superseded: readFirestoreBool(fields.superseded),
    supersededAt: readFirestoreString(fields.superseded_at),
    scope,
    hubId
  };
}

function readFirestoreBool(value: unknown): boolean {
  if (value && typeof value === "object") {
    return Boolean((value as Record<string, unknown>).booleanValue);
  }
  return false;
}

function readFirestoreStringArray(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const raw = value as Record<string, unknown>;
  const arrayValue = isRecord(raw.arrayValue) ? raw.arrayValue : {};
  const values = Array.isArray(arrayValue.values) ? arrayValue.values : [];
  return values.map(readFirestoreString).filter(Boolean);
}

function readFirestoreNumber(value: unknown): number {
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    return readNumber(raw.integerValue ?? raw.doubleValue);
  }
  return 0;
}

function readString(value: unknown): string {
  return String(value ?? "").trim();
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(readString).filter(Boolean);
}

function isGenericDisplayName(value: unknown): boolean {
  return GENERIC_DISPLAY_NAMES.has(readString(value).toLowerCase().replace(/\s+/g, " ")) || isGenericAccountDisplayName(value);
}

function fallbackAccountName(uid = ""): string {
  const suffix = uid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
  return suffix ? `Player#${suffix}` : "";
}

function bestDisplayNameCandidate(...values: unknown[]): string {
  for (const value of values) {
    const cleaned = readString(value).replace(/\s+/g, " ").slice(0, 40);
    if (cleaned && !isGenericDisplayName(cleaned)) {
      return cleaned;
    }
  }
  return "";
}

function bestLocalAccountDisplayName(settings: UserSettings, profile?: AccountProfile | null, ...candidates: unknown[]): string {
  return bestDisplayNameCandidate(
    ...candidates,
    profile?.displayName,
    settings.accountDisplayName,
    profile?.handle,
    settings.accountHandle,
    settings.username,
    fallbackAccountName(profile?.uid || settings.accountUid || settings.firebaseUid)
  );
}

function resolveCommunityUsername(match: Record<string, unknown>, uid: string): string {
  return bestDisplayNameCandidate(
    match.username,
    match.owner_display_name,
    match.ownerDisplayName,
    match.displayName,
    match.owner_handle,
    match.ownerHandle,
    match.accountHandle,
    fallbackAccountName(uid)
  );
}

function normalizedDeckValue(value: unknown): string {
  return readString(value).toLowerCase().replace(/^tcga:/, "").replace(/\s+/g, " ");
}

function isGenericDeckValue(value: unknown): boolean {
  const cleaned = normalizedDeckValue(value);
  return !cleaned || GENERIC_DECK_NAMES.has(cleaned);
}

function sanitizeDeckName(value: unknown): string {
  const cleaned = readString(value).replace(/\s+/g, " ").slice(0, 80);
  return cleaned && !isGenericDeckValue(cleaned) ? cleaned : "";
}

function sanitizeDeckSourceKey(value: unknown): string {
  const cleaned = readString(value);
  return cleaned && !isGenericDeckValue(cleaned) ? cleaned : "";
}

function sanitizeDeckSourceUrl(value: unknown): string {
  const cleaned = readString(value);
  if (!cleaned) {
    return "";
  }
  const tcgaDeckKey = cleaned.match(/^tcga:\/\/deck\/(.+)$/i)?.[1] ?? "";
  return tcgaDeckKey && isGenericDeckValue(tcgaDeckKey) ? "" : cleaned;
}

function readNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readFormat(value: unknown): CommunityMatch["format"] {
  const raw = readString(value).toLowerCase().replace(/\s+/g, "");
  if (raw === "bo3" || raw === "bestof3") return "Bo3";
  if (raw === "auto") return "Auto";
  return "Bo1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function buildSyncDoc(match: MatchDraft, settings: UserSettings, uid: string, options: { includeFlags: boolean }): Record<string, unknown> {
  const username = bestLocalAccountDisplayName(settings, undefined, match.myName);
  const opponentName = sameName(match.opponentName, username) ? "" : match.opponentName;
  const deckName = sanitizeDeckName(match.deckName);
  const deckSourceKey = sanitizeDeckSourceKey(match.deckSourceKey || match.deckSourceId);
  const deckSourceUrl = sanitizeDeckSourceUrl(match.deckSourceUrl);
  const hasDeckAttachment = Boolean(deckName || deckSourceUrl || deckSourceKey || match.deckSnapshotJson?.trim());
  return {
    uid,
    owner_uid: settings.accountUid || uid,
    owner_handle: settings.accountHandle,
    owner_display_name: username,
    profile_public: settings.accountProfilePublic,
    visibility: settings.accountProfilePublic ? "public-profile" : "community",
    local_match_id: match.id,
    username,
    date: match.capturedAt,
    result: match.result,
    my_champion: normalizeLegendName(match.myChampion),
    opp_champion: normalizeLegendName(match.opponentChampion),
    opp_name: opponentName,
    fmt: match.format,
    score: match.score,
    went_first: match.games[0]?.wentFirst ?? "",
    my_battlefield: match.myBattlefield,
    opp_battlefield: match.opponentBattlefield,
    flags: options.includeFlags ? normalizeFlags(match.flags) : "",
    games_json: JSON.stringify(match.games),
    my_deck_name: hasDeckAttachment ? deckName : "",
    my_deck_source_url: hasDeckAttachment ? deckSourceUrl : "",
    my_deck_source_key: hasDeckAttachment ? deckSourceKey : "",
    my_deck_snapshot_json: hasDeckAttachment ? match.deckSnapshotJson ?? "" : "",
    platform: match.platform,
    manual_repair: Boolean(match.manualRepair),
    combined_from_match_ids: match.combinedFromMatchIds ?? [],
    merged_into_match_id: match.mergedIntoMatchId ?? "",
    superseded: Boolean(match.mergedIntoMatchId || match.hiddenFromStats || match.hiddenFromHistory),
    superseded_at: match.mergedIntoMatchId || match.hiddenFromStats || match.hiddenFromHistory ? match.updatedAt : "",
    created_at: Math.floor(new Date(match.capturedAt).getTime() / 1000) || Math.floor(Date.now() / 1000)
  };
}

function isManualSource(match: MatchDraft): boolean {
  if (match.manualRepair) {
    return false;
  }
  return match.source === "scorepad" || match.source === "manual";
}

function toFirestoreFields(doc: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(doc).map(([key, value]) => [key, toFirestoreValue(value)]));
}

function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (typeof value === "number" && Number.isInteger(value)) {
    return { integerValue: String(value) };
  }
  if (typeof value === "number") {
    return { doubleValue: value };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (value && typeof value === "object") {
    return { mapValue: { fields: toFirestoreFields(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value ?? "") };
}

function normalizeFlags(flags: string): string {
  return Array.from(new Set(flags.split(",").map((flag) => flag.trim()).filter(Boolean))).join(", ");
}

function sameName(left: string, right: string): boolean {
  const a = left.trim().toLowerCase().replace(/\s+/g, " ");
  const b = right.trim().toLowerCase().replace(/\s+/g, " ");
  return Boolean(a && b && a === b);
}

function normalizeAccountProfile(value: unknown): AccountProfile {
  const profile = isRecord(value) ? value : {};
  return {
    uid: readString(profile.uid),
    email: readString(profile.email),
    handle: readString(profile.handle),
    handleLower: readString(profile.handleLower),
    displayName: readString(profile.displayName),
    searchable: Boolean(profile.searchable),
    publicProfile: Boolean(profile.publicProfile),
    showStats: profile.showStats !== false,
    showMatches: profile.showMatches !== false,
    showDecks: profile.showDecks !== false,
    showHubBadges: Boolean(profile.showHubBadges),
    marketingConsent: Boolean(profile.marketingConsent),
    marketingConsentAt: readNumber(profile.marketingConsentAt),
    marketingConsentUpdatedAt: readNumber(profile.marketingConsentUpdatedAt),
    marketingConsentVersion: readString(profile.marketingConsentVersion),
    marketingConsentSource: readString(profile.marketingConsentSource),
    createdAt: readNumber(profile.createdAt),
    updatedAt: readNumber(profile.updatedAt)
  };
}

function normalizeHubMember(value: Record<string, unknown>): HubMember {
  const role = readString(value.role);
  const uid = readString(value.uid) || readString(value.id);
  const handle = readString(value.handle);
  return {
    id: readString(value.id) || uid,
    uid,
    handle,
    displayName: bestDisplayNameCandidate(value.displayName, handle, fallbackAccountName(uid)),
    role: role === "owner" || role === "admin" ? role : "member",
    joinedAt: readNumber(value.joinedAt),
    updatedAt: readNumber(value.updatedAt)
  };
}

function normalizeHubInboxItem(value: Record<string, unknown>): HubInboxItem {
  const status = readString(value.status);
  const senderUid = readString(value.senderUid);
  const senderHandle = readString(value.senderHandle);
  return {
    id: readString(value.id) || readString(value.inviteId),
    type: "hub-invite",
    inviteId: readString(value.inviteId) || readString(value.id),
    hubId: readString(value.hubId),
    hubName: readString(value.hubName) || readString(value.hubId),
    senderUid,
    senderHandle,
    senderDisplayName: bestDisplayNameCandidate(value.senderDisplayName, senderHandle, fallbackAccountName(senderUid)),
    targetHandle: readString(value.targetHandle),
    status: status === "accepted" || status === "declined" || status === "expired" ? status : "open",
    createdAt: readNumber(value.createdAt),
    expiresAt: readNumber(value.expiresAt),
    readAt: readNumber(value.readAt)
  };
}

function normalizeHubMessage(value: Record<string, unknown>): HubMessage {
  const uid = readString(value.uid);
  const handle = readString(value.handle);
  return {
    id: readString(value.id),
    uid,
    handle,
    displayName: bestDisplayNameCandidate(value.displayName, handle, fallbackAccountName(uid)),
    text: readString(value.text),
    mentions: Array.isArray(value.mentions) ? value.mentions.map(readString).filter(Boolean) : [],
    pinned: Boolean(value.pinned),
    deleted: Boolean(value.deleted),
    createdAt: readNumber(value.createdAt),
    updatedAt: readNumber(value.updatedAt)
  };
}

function normalizeLfgListing(value: Record<string, unknown>): LfgListing {
  const platform = readString(value.platform);
  const format = readString(value.format);
  const status = readString(value.status);
  const uid = readString(value.uid);
  const handle = readString(value.handle);
  return {
    id: readString(value.id),
    uid,
    handle,
    displayName: bestDisplayNameCandidate(value.displayName, handle, fallbackAccountName(uid)),
    platform: platform === "tcga" ? "tcga" : "atlas",
    roomCode: readString(value.roomCode),
    format: format === "Bo1" ? "Bo1" : "Bo3",
    myLegend: readString(value.myLegend),
    lookingForLegends: Array.isArray(value.lookingForLegends) ? value.lookingForLegends.map(readString).filter(Boolean) : [],
    allowAny: Boolean(value.allowAny),
    note: readString(value.note),
    status: status === "closed" || status === "expired"
      ? status
      : status === "matched" || status === "accepted"
        ? "matched"
        : "active",
    acceptedByUid: readString(value.acceptedByUid),
    acceptedByHandle: readString(value.acceptedByHandle),
    acceptedByDisplayName: bestDisplayNameCandidate(value.acceptedByDisplayName, readString(value.acceptedByHandle), fallbackAccountName(readString(value.acceptedByUid))),
    acceptedAt: readNumber(value.acceptedAt),
    createdAt: readNumber(value.createdAt),
    expiresAt: readNumber(value.expiresAt),
    closedAt: readNumber(value.closedAt),
    discordVoiceChannelId: readString(value.discordVoiceChannelId),
    discordGuildId: readString(value.discordGuildId),
    discordChannelUrl: readString(value.discordChannelUrl),
    discordAppUrl: readString(value.discordAppUrl),
    discordInviteUrl: readString(value.discordInviteUrl),
    discordVoiceExpiresAt: readNumber(value.discordVoiceExpiresAt),
    discordVoiceCreatedAt: readNumber(value.discordVoiceCreatedAt)
  };
}

function isSocialHubApiPath(path: string): boolean {
  return path.startsWith("/api/lfg") || path.startsWith("/api/teams") || path.startsWith("/api/moderation");
}

function normalizeSocialTeam(value: Record<string, unknown>): SocialTeamProfile {
  const socials = isRecord(value.socials) ? value.socials : {};
  const visibility = readString(value.visibility);
  return {
    id: readString(value.id),
    slug: readString(value.slug) || readString(value.id),
    name: readString(value.name) || readString(value.slug) || "RiftLite team",
    description: readString(value.description),
    region: readString(value.region),
    locationMode: readString(value.locationMode),
    visibility: visibility === "private" ? "private" : "public",
    purposes: Array.isArray(value.purposes) ? value.purposes.map(readString).filter(Boolean) : [],
    recruitmentStatus: readString(value.recruitmentStatus) || "open",
    logoUrl: readString(value.logoUrl),
    bannerUrl: readString(value.bannerUrl),
    website: readString(value.website),
    discord: readString(value.discord),
    socials: {
      x: readString(socials.x),
      youtube: readString(socials.youtube),
      twitch: readString(socials.twitch),
      instagram: readString(socials.instagram),
      metafy: readString(socials.metafy)
    },
    ownerUid: readString(value.ownerUid),
    ownerHandle: readString(value.ownerHandle),
    ownerDisplayName: bestDisplayNameCandidate(value.ownerDisplayName, value.ownerHandle, fallbackAccountName(readString(value.ownerUid))),
    memberCount: readNumber(value.memberCount),
    applicationCount: readNumber(value.applicationCount),
    createdAt: readNumber(value.createdAt),
    updatedAt: readNumber(value.updatedAt)
  };
}

function normalizeTeamModerationRecord(value: Record<string, unknown>): TeamModerationRecord {
  return {
    ...normalizeSocialTeam(value),
    hidden: Boolean(value.hidden),
    moderationStatus: readString(value.moderationStatus),
    moderationReason: readString(value.moderationReason),
    moderatedAt: readNumber(value.moderatedAt),
    moderatedBy: readString(value.moderatedBy)
  };
}

function readTeamRole(value: unknown): SocialTeamMember["role"] | "" {
  const role = readString(value);
  return role === "owner" || role === "admin" || role === "member" ? role : "";
}

function normalizeSocialTeamMember(value: Record<string, unknown>): SocialTeamMember {
  const uid = readString(value.uid) || readString(value.id);
  const handle = readString(value.handle);
  return {
    id: readString(value.id) || uid,
    uid,
    handle,
    displayName: bestDisplayNameCandidate(value.displayName, handle, fallbackAccountName(uid)),
    role: readTeamRole(value.role) || "member",
    joinedAt: readNumber(value.joinedAt),
    updatedAt: readNumber(value.updatedAt)
  };
}

function normalizeSocialTeamApplication(value: Record<string, unknown>): SocialTeamApplication {
  const status = readString(value.status);
  const uid = readString(value.uid);
  const handle = readString(value.handle);
  return {
    id: readString(value.id),
    teamId: readString(value.teamId),
    uid,
    handle,
    displayName: bestDisplayNameCandidate(value.displayName, handle, fallbackAccountName(uid)),
    message: readString(value.message),
    region: readString(value.region),
    preferredLegends: Array.isArray(value.preferredLegends) ? value.preferredLegends.map(readString).filter(Boolean) : [],
    availability: readString(value.availability),
    status: status === "accepted" || status === "declined" || status === "withdrawn" ? status : "pending",
    createdAt: readNumber(value.createdAt),
    updatedAt: readNumber(value.updatedAt),
    reviewedAt: readNumber(value.reviewedAt),
    reviewedBy: readString(value.reviewedBy)
  };
}

function normalizeSocialTeamMessage(value: Record<string, unknown>): SocialTeamMessage {
  const uid = readString(value.uid);
  const handle = readString(value.handle);
  return {
    id: readString(value.id),
    uid,
    handle,
    displayName: bestDisplayNameCandidate(value.displayName, handle, fallbackAccountName(uid)),
    text: readString(value.text),
    mentions: Array.isArray(value.mentions) ? value.mentions.map(readString).filter(Boolean) : [],
    pinned: Boolean(value.pinned),
    deleted: Boolean(value.deleted),
    createdAt: readNumber(value.createdAt),
    updatedAt: readNumber(value.updatedAt)
  };
}
