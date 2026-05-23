import type { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { normalizeLegendName } from "../../shared/legendNames.js";
import { publicCommunitySyncEnabled } from "../../shared/syncPolicy.js";
import type {
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

export class FirebaseSyncService {
  private auth: AuthState | null = null;

  constructor(
    private readonly store: RiftLiteStore,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

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

    const saved = await this.store.saveMatch(next);
    if (!options.quiet) {
      this.getWindow()?.webContents.send("match:draft", saved);
    }
    return saved;
  }

  async createHub(name: string, password: string, settings: UserSettings): Promise<HubActionResult> {
    const auth = await this.getAuth(settings);
    const hub = buildHub(name, password, "owner");
    try {
      await this.firestoreRequest(`hubs/${hub.id}`, auth.idToken, { method: "GET" });
      throw new Error("A private hub with that exact name already exists");
    } catch (error) {
      if (!isFirestoreMissing(error)) {
        throw error;
      }
    }
    await this.firestoreRequest(`hubs/${hub.id}`, auth.idToken, {
      method: "PATCH",
      body: {
        fields: toFirestoreFields({
          id: hub.id,
          name: hub.name,
          password_hash: hub.passwordHash,
          created_by: auth.uid,
          created_at: Math.floor(Date.now() / 1000),
          hidden: true
        })
      }
    });
    const nextSettings = await this.store.saveSettings({
      activeHubs: upsertHub(settings.activeHubs, hub),
      syncMode: publicCommunitySyncEnabled(settings) ? "community-and-hubs" : "private-hubs-only",
      communitySyncEnabled: publicCommunitySyncEnabled(settings)
    });
    return { hub, settings: nextSettings };
  }

  async joinHub(name: string, password: string, settings: UserSettings): Promise<HubActionResult> {
    const auth = await this.getAuth(settings);
    const hub = buildHub(name, password, "member");
    const doc = await this.firestoreRequest(`hubs/${hub.id}`, auth.idToken, { method: "GET" });
    const fields = doc.fields && typeof doc.fields === "object" ? doc.fields as Record<string, unknown> : {};
    const remoteHash = readFirestoreString(fields.password_hash);
    if (!remoteHash || remoteHash !== hub.passwordHash) {
      throw new Error("Private hub name or password did not match");
    }
    const remoteName = readFirestoreString(fields.name) || hub.name;
    const nextHub = { ...hub, name: remoteName };
    const nextSettings = await this.store.saveSettings({
      activeHubs: upsertHub(settings.activeHubs, nextHub),
      syncMode: publicCommunitySyncEnabled(settings) ? "community-and-hubs" : "private-hubs-only",
      communitySyncEnabled: publicCommunitySyncEnabled(settings)
    });
    return { hub: nextHub, settings: nextSettings };
  }

  async getCommunityMatches(forceRefresh = false, limit = COMMUNITY_FIRESTORE_FALLBACK_LIMIT): Promise<CommunityMatch[]> {
    const settings = await this.store.getSettings();
    const webMatches = await this.getCommunityMatchesFromWebsite(forceRefresh);
    if (webMatches) {
      return repairCommunityMatchesForSettings(webMatches, settings);
    }
    const auth = await this.getAuth(settings);
    const response = await this.firestoreRunQuery("", auth.idToken, {
      structuredQuery: {
        from: [{ collectionId: "matches" }],
        orderBy: [{ field: { fieldPath: "created_at" }, direction: "DESCENDING" }],
        limit
      }
    });
    return repairCommunityMatchesForSettings(response.map((doc) => fromFirestoreDoc(doc, "community")), settings);
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
          return dedupeCommunityMatches(items.filter(isRecord).map((item) => fromWebMatch(item, "community")));
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
    return response.map((doc) => fromFirestoreDoc(doc, "hub", hubId));
  }

  async getTeamMatches(teamId: string, forceRefresh = false, limit = 1000): Promise<CommunityMatch[]> {
    const query = new URLSearchParams({
      limit: String(Math.max(1, Math.min(limit, 2000))),
      refresh: forceRefresh ? "1" : "0"
    });
    const payload = await this.authenticatedWebsiteRequest(`/api/teams/${encodeURIComponent(teamId)}/matches?${query}`, { method: "GET" });
    return webCommunityItems(payload)
      .filter(isRecord)
      .map((item) => fromWebMatch(item, "team", teamId));
  }

  async deleteHubMatch(hubId: string, matchId: string): Promise<void> {
    const settings = await this.store.getSettings();
    const auth = await this.getAuth(settings);
    const safeHubId = encodeURIComponent(hubId);
    const safeMatchId = encodeURIComponent(matchId);
    await this.firestoreRequest(`hubs/${safeHubId}/matches/${safeMatchId}`, auth.idToken, { method: "DELETE" });
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
    const payload = await this.authenticatedWebsiteRequest("/api/auth/link/start", { method: "POST" });
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
      this.auth = await this.signInWithCustomToken(customToken);
      const currentSettings = await this.store.getSettings();
      const displayName = bestLocalAccountDisplayName(currentSettings, undefined, readString(payload.displayName));
      const settings = await this.store.saveSettings({
        firebaseUid: this.auth.uid,
        firebaseRefreshToken: this.auth.refreshToken,
        accountUid: this.auth.uid,
        accountEmail: readString(payload.email),
        accountDisplayName: displayName
      });
      await this.getAccountProfile().catch(async () => {
        await this.store.saveSettings({
          accountUid: settings.accountUid || this.auth?.uid || "",
          accountEmail: settings.accountEmail,
          accountDisplayName: settings.accountDisplayName
        });
      });
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

  async unlinkAccount(): Promise<UserSettings> {
    this.auth = null;
    return this.store.saveSettings({
      firebaseUid: "",
      firebaseRefreshToken: "",
      accountUid: "",
      accountEmail: "",
      accountHandle: "",
      accountDisplayName: "",
      accountProfilePublic: false
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

  async claimHub(hubId: string, passwordHash?: string): Promise<void> {
    const settings = await this.store.getSettings();
    const hub = settings.activeHubs.find((item) => item.id === hubId);
    const hash = passwordHash || hub?.passwordHash || "";
    const profile = await this.getAccountProfile().catch(() => null);
    await this.authenticatedWebsiteRequest("/api/hubs/claim", {
      method: "POST",
      body: {
        hubId,
        passwordHash: hash,
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

  private async getAuth(settings: UserSettings): Promise<AuthState> {
    const now = Math.floor(Date.now() / 1000);
    if (this.auth && this.auth.expiresAt - TOKEN_FRESH_SECONDS > now) {
      return this.auth;
    }
    if (settings.firebaseRefreshToken) {
      try {
        this.auth = await this.refreshToken(settings.firebaseRefreshToken);
        await this.store.saveSettings({
          firebaseUid: this.auth.uid,
          firebaseRefreshToken: this.auth.refreshToken
        });
        return this.auth;
      } catch {
        this.auth = null;
      }
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

  private async authenticatedWebsiteRequest(path: string, options: { method: "GET" | "DELETE"; body?: never } | { method: "POST" | "PATCH"; body?: unknown }): Promise<Record<string, unknown>> {
    const settings = await this.store.getSettings();
    const auth = await this.getAuth(settings);
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

  private async firestoreRequest(path: string, idToken: string, options: { method: "GET" | "DELETE"; body?: never } | { method: "POST" | "PATCH"; body: unknown }): Promise<Record<string, unknown>> {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
    const response = await fetch(url, {
      method: options.method,
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: options.method === "GET" || options.method === "DELETE" ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) {
      throw new Error(`Firestore ${response.status}`);
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
}

function buildHub(name: string, password: string, role: PrivateHub["role"]): PrivateHub {
  const cleanName = name.trim();
  const passwordHash = createHash("sha256").update(password).digest("hex");
  const id = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
  return {
    id,
    name: cleanName,
    sync: true,
    passwordHash,
    role,
    joinedAt: new Date().toISOString()
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
    scope,
    hubId
  };
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

function isGenericDisplayName(value: unknown): boolean {
  const cleaned = readString(value).toLowerCase().replace(/\s+/g, " ");
  return !cleaned || GENERIC_DISPLAY_NAMES.has(cleaned) || /^player(?:[ _-]|$)/.test(cleaned);
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
    settings.username,
    profile?.handle,
    settings.accountHandle,
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

function isFirestoreMissing(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Firestore 404");
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
    created_at: Math.floor(new Date(match.capturedAt).getTime() / 1000) || Math.floor(Date.now() / 1000)
  };
}

function isManualSource(match: MatchDraft): boolean {
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
