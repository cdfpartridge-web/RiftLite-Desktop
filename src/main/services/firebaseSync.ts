import type { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { normalizeLegendName } from "../../shared/legendNames.js";
import { publicCommunitySyncEnabled } from "../../shared/syncPolicy.js";
import type { CommunityMatch, HubActionResult, PrivateHub, MatchDraft, UserSettings } from "../../shared/types.js";
import { RiftLiteStore } from "./store.js";

const FIREBASE_API_KEY = "AIzaSyBNqEY-i_CggjhDKVltoPQFrSOEfHF7fBA";
const FIREBASE_PROJECT_ID = "riftlite-b61a5";
const COMMUNITY_API_BASE = "https://www.riftlite.com";
const COMMUNITY_API_BASES = ["https://www.riftlite.com", "https://riftlite.com"];
const COMMUNITY_FIRESTORE_FALLBACK_LIMIT = 500;
const TOKEN_FRESH_SECONDS = 300;

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

  async syncMatch(match: MatchDraft): Promise<MatchDraft> {
    const settings = await this.store.getSettings();
    let next: MatchDraft = { ...match, sync: { community: match.sync.community, hubs: { ...match.sync.hubs } } };

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

    const saved = await this.store.saveMatch(next);
    this.getWindow()?.webContents.send("match:draft", saved);
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
    const webMatches = await this.getCommunityMatchesFromWebsite(forceRefresh);
    if (webMatches) {
      return webMatches;
    }
    const settings = await this.store.getSettings();
    const auth = await this.getAuth(settings);
    const response = await this.firestoreRunQuery("", auth.idToken, {
      structuredQuery: {
        from: [{ collectionId: "matches" }],
        orderBy: [{ field: { fieldPath: "created_at" }, direction: "DESCENDING" }],
        limit
      }
    });
    return response.map((doc) => fromFirestoreDoc(doc, "community"));
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

  private async uploadPublicMatch(match: MatchDraft, settings: UserSettings): Promise<string> {
    const auth = await this.getAuth(settings);
    const doc = buildPublicDoc(match, settings, auth.uid);
    const response = await this.firestoreRequest("matches", auth.idToken, {
      method: "POST",
      body: { fields: toFirestoreFields(doc) }
    });
    const name = typeof response.name === "string" ? response.name : "";
    const docId = name.split("/").pop() ?? "";
    if (docId) {
      await this.appendCommunityAggregate(docId, doc, auth.idToken).catch(() => undefined);
    }
    return docId;
  }

  private async uploadHubMatch(hubId: string, match: MatchDraft, settings: UserSettings): Promise<string> {
    const auth = await this.getAuth(settings);
    const doc = buildPublicDoc(match, settings, auth.uid);
    const safeHubId = encodeURIComponent(hubId);
    const safeMatchId = encodeURIComponent(match.id);
    const response = await this.firestoreRequest(`hubs/${safeHubId}/matches/${safeMatchId}`, auth.idToken, {
      method: "PATCH",
      body: { fields: toFirestoreFields(doc) }
    });
    const name = typeof response.name === "string" ? response.name : "";
    return name.split("/").pop() ?? "";
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
  return {
    id: readString(match.id),
    uid: readString(match.uid),
    username: readString(match.username),
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
    deckName: readString(match.my_deck_name) || readString(match.deckName),
    deckSourceUrl: readString(match.my_deck_source_url) || readString(match.deckSourceUrl),
    deckSourceKey: readString(match.my_deck_source_key) || readString(match.deckSourceKey),
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
  return {
    id: name.split("/").pop() ?? "",
    uid: readFirestoreString(fields.uid),
    username: readFirestoreString(fields.username),
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
    deckName: readFirestoreString(fields.my_deck_name),
    deckSourceUrl: readFirestoreString(fields.my_deck_source_url),
    deckSourceKey: readFirestoreString(fields.my_deck_source_key),
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

function buildPublicDoc(match: MatchDraft, settings: UserSettings, uid: string): Record<string, unknown> {
  const username = settings.username || match.myName;
  const opponentName = sameName(match.opponentName, username) ? "" : match.opponentName;
  return {
    uid,
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
    flags: normalizeFlags(match.flags),
    games_json: JSON.stringify(match.games),
    my_deck_name: match.deckName,
    my_deck_source_url: match.deckSourceUrl ?? "",
    my_deck_source_key: match.deckSourceKey || match.deckSourceId,
    my_deck_snapshot_json: match.deckSnapshotJson ?? "",
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
